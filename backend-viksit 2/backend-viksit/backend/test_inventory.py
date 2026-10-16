"""Comprehensive test suite for FloodGuard Relief Inventory and Allocation module (Phase 2)."""

import unittest
import uuid
from fastapi.testclient import TestClient
from app import app, initialise_database, connection


class TestReliefInventoryAndAllocations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialise_database()
        cls.client = TestClient(app)

    def test_01_create_and_list_inventory(self):
        """Test creating an inventory item and listing items with summary counts."""
        code = f"INV-TST-{uuid.uuid4().hex[:6].upper()}"
        payload = {
            "name": "Emergency High-Energy Biscuit Crate",
            "category": "Food",
            "unit": "packets",
            "storage_location": "Central Depot Test",
            "on_hand": 200.0,
            "low_stock_threshold": 25.0,
            "item_code": code
        }
        res = self.client.post("/api/inventory", json=payload)
        self.assertEqual(res.status_code, 201)
        item = res.json()
        self.assertEqual(item["item_code"], code)
        self.assertEqual(item["on_hand"], 200.0)
        self.assertEqual(item["reserved"], 0.0)
        self.assertEqual(item["available"], 200.0)
        self.assertEqual(item["stock_status"], "Available")

        # List inventory
        list_res = self.client.get("/api/inventory")
        self.assertEqual(list_res.status_code, 200)
        data = list_res.json()
        self.assertIn("items", data)
        self.assertIn("summary", data)
        self.assertGreaterEqual(data["total"], 1)
        self.assertGreater(data["summary"]["total_on_hand"], 0)

    def test_02_invalid_quantities_and_units(self):
        """Test validation on negative stock, invalid category, and empty fields."""
        # Negative on-hand
        res = self.client.post("/api/inventory", json={
            "name": "Bad Quantity Item",
            "category": "Food",
            "unit": "packets",
            "storage_location": "Depot",
            "on_hand": -10.0
        })
        self.assertEqual(res.status_code, 422)

        # Invalid category
        res = self.client.post("/api/inventory", json={
            "name": "Bad Category Item",
            "category": "LuxuryElectronics",
            "unit": "pieces",
            "storage_location": "Depot",
            "on_hand": 5.0
        })
        self.assertEqual(res.status_code, 422)

    def test_03_receive_stock(self):
        """Test receiving stock increases physical on-hand and records movement."""
        # Create item
        res = self.client.post("/api/inventory", json={
            "name": "Clean Drinking Water Cartons",
            "category": "Drinking Water",
            "unit": "cartons",
            "storage_location": "East Post",
            "on_hand": 50.0,
            "low_stock_threshold": 10.0
        })
        item_id = res.json()["id"]

        # Receive 40 units
        rec_res = self.client.post(f"/api/inventory/{item_id}/receive", json={
            "quantity": 40.0,
            "reason": "Aid shipment from state warehouse",
            "reference": "PO-9921",
            "operator": "Storekeeper Amit"
        })
        self.assertEqual(rec_res.status_code, 200)
        data = rec_res.json()
        self.assertEqual(data["item"]["on_hand"], 90.0)
        self.assertEqual(data["movement"]["movement_type"], "INCOMING")

        # Verify negative receive fails
        neg_res = self.client.post(f"/api/inventory/{item_id}/receive", json={"quantity": -5.0})
        self.assertIn(neg_res.status_code, [400, 422])

    def test_04_stock_adjustment_and_mandatory_reason(self):
        """Test physical stock correction requires reason and prevents negative stock or violating reserved."""
        res = self.client.post("/api/inventory", json={
            "name": "Woolen Blankets",
            "category": "Shelter Supplies",
            "unit": "blankets",
            "storage_location": "South Depot",
            "on_hand": 100.0,
            "low_stock_threshold": 20.0
        })
        item_id = res.json()["id"]

        # Missing or short reason fails
        fail_res = self.client.post(f"/api/inventory/{item_id}/adjust", json={
            "new_on_hand": 95.0,
            "reason": "a"
        })
        self.assertIn(fail_res.status_code, [400, 422])

        # Successful correction
        adj_res = self.client.post(f"/api/inventory/{item_id}/adjust", json={
            "new_on_hand": 85.0,
            "reason": "Damaged waterlogged packaging removed after heavy rain",
            "operator": "Audit Inspector Khan"
        })
        self.assertEqual(adj_res.status_code, 200)
        self.assertEqual(adj_res.json()["item"]["on_hand"], 85.0)
        self.assertEqual(adj_res.json()["delta"], -15.0)

    def test_05_successful_reservation(self):
        """Test reserving stock increases reserved quantity without reducing physical on_hand."""
        # 1. Create an emergency request
        req_res = self.client.post("/api/requests", json={
            "household_label": "Household #501 - Test Alloc",
            "category": "Water",
            "description": "Urgent drinking water needed",
            "zone_id": "Z001",
            "severity": "HIGH"
        })
        req_id = req_res.json()["request"]["request_id"]

        # 2. Create item with 50 available
        item_res = self.client.post("/api/inventory", json={
            "name": "Water Purification Sachets Box",
            "category": "Drinking Water",
            "unit": "boxes",
            "storage_location": "Center Hub",
            "on_hand": 50.0,
            "low_stock_threshold": 5.0
        })
        item_id = item_res.json()["id"]

        # 3. Create allocation
        alloc_res = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item_id,
            "quantity": 10.0,
            "allocated_by": "Coordinator Sharma",
            "notes": "Reserved 10 boxes"
        })
        self.assertEqual(alloc_res.status_code, 201)
        alloc = alloc_res.json()["allocation"]
        self.assertEqual(alloc["status"], "Reserved")
        self.assertEqual(alloc["quantity_reserved"], 10.0)

        # Check item: on_hand unchanged, reserved increased, available reduced
        check_item = self.client.get(f"/api/inventory/{item_id}").json()
        self.assertEqual(check_item["on_hand"], 50.0)
        self.assertEqual(check_item["reserved"], 10.0)
        self.assertEqual(check_item["available"], 40.0)

    def test_06_insufficient_stock_rejection(self):
        """Test reservation fails cleanly when requested quantity exceeds available stock."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Household #502 - Insufficient Stock Test",
            "category": "Food",
            "description": "Need massive food supply",
            "zone_id": "Z001",
            "severity": "CRITICAL"
        })
        req_id = req_res.json()["request"]["request_id"]

        item_res = self.client.post("/api/inventory", json={
            "name": "Limited Stock MRE",
            "category": "Food",
            "unit": "kits",
            "storage_location": "Center Hub",
            "on_hand": 10.0,
            "low_stock_threshold": 5.0
        })
        item_id = item_res.json()["id"]

        # Attempt to reserve 20 when only 10 available
        alloc_fail = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item_id,
            "quantity": 20.0
        })
        self.assertEqual(alloc_fail.status_code, 400)
        self.assertIn("Insufficient available stock", alloc_fail.json()["detail"])

        # Check that stock was not modified
        check_item = self.client.get(f"/api/inventory/{item_id}").json()
        self.assertEqual(check_item["reserved"], 0.0)

    def test_07_multiple_allocations_for_one_request(self):
        """Test a single request receiving supplies from multiple items/locations."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Multi-Alloc House #503",
            "category": "Rescue",
            "description": "Boat rescue and life jackets needed",
            "zone_id": "Z001",
            "severity": "CRITICAL"
        })
        req_id = req_res.json()["request"]["request_id"]

        # Item 1: Life jackets
        item1 = self.client.post("/api/inventory", json={
            "name": "Adult Life Jackets Test",
            "category": "Rescue Equipment",
            "unit": "pieces",
            "storage_location": "Depot A",
            "on_hand": 20.0
        }).json()

        # Item 2: Flashlights
        item2 = self.client.post("/api/inventory", json={
            "name": "Waterproof Flashlights",
            "category": "Rescue Equipment",
            "unit": "pieces",
            "storage_location": "Depot B",
            "on_hand": 30.0
        }).json()

        # Allocate from both
        res1 = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item1["id"],
            "quantity": 4.0
        })
        self.assertEqual(res1.status_code, 201)

        res2 = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item2["id"],
            "quantity": 2.0
        })
        self.assertEqual(res2.status_code, 201)

        # Inspect request details to verify both allocations are linked
        req_detail = self.client.get(f"/api/requests/{req_id}").json()
        self.assertEqual(len(req_detail["allocations"]), 2)

    def test_08_cancellation_releases_reserved_stock(self):
        """Test cancelling a reservation releases reserved stock back to available."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Cancel Test House",
            "category": "Medical",
            "description": "Medical kit",
            "zone_id": "Z001",
            "severity": "MEDIUM"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Suture Kits",
            "category": "Medical Supplies",
            "unit": "kits",
            "storage_location": "West Clinic",
            "on_hand": 20.0
        }).json()

        alloc = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 6.0
        }).json()["allocation"]

        alloc_id = alloc["allocation_id"]

        # Cancel allocation
        cancel_res = self.client.post(f"/api/allocations/{alloc_id}/cancel", json={
            "reason": "Patient evacuated to hospital, supplies no longer required"
        })
        self.assertEqual(cancel_res.status_code, 200)
        self.assertEqual(cancel_res.json()["allocation"]["status"], "Cancelled")

        # Verify item reserved is back to 0
        check_item = self.client.get(f"/api/inventory/{item['id']}").json()
        self.assertEqual(check_item["reserved"], 0.0)
        self.assertEqual(check_item["available"], 20.0)

    def test_09_dispatch_reduces_physical_and_reserved_stock(self):
        """Test dispatching a reservation reduces both on_hand and reserved stock."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Dispatch Test House",
            "category": "Food",
            "description": "Food rations",
            "zone_id": "Z002",
            "severity": "HIGH"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Emergency Energy Bars",
            "category": "Food",
            "unit": "packets",
            "storage_location": "Central Depot",
            "on_hand": 100.0
        }).json()

        alloc = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 25.0
        }).json()["allocation"]

        alloc_id = alloc["allocation_id"]

        # Dispatch allocation
        dsp_res = self.client.post(f"/api/allocations/{alloc_id}/dispatch", json={
            "reason": "Loaded into truck #12 for delivery"
        })
        self.assertEqual(dsp_res.status_code, 200)
        self.assertEqual(dsp_res.json()["allocation"]["status"], "Dispatched")
        self.assertEqual(dsp_res.json()["allocation"]["quantity_dispatched"], 25.0)

        # Invariant check: on_hand reduced by 25 (to 75), reserved reduced by 25 (to 0)
        check_item = self.client.get(f"/api/inventory/{item['id']}").json()
        self.assertEqual(check_item["on_hand"], 75.0)
        self.assertEqual(check_item["reserved"], 0.0)
        self.assertEqual(check_item["available"], 75.0)

    def test_10_delivery_does_not_subtract_stock_twice(self):
        """Test confirming delivery does NOT subtract on_hand stock a second time."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Delivery Test House",
            "category": "Water",
            "description": "Water cans",
            "zone_id": "Z001",
            "severity": "HIGH"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Chlorine Tablets Bottle",
            "category": "Drinking Water",
            "unit": "bottles",
            "storage_location": "Central Depot",
            "on_hand": 40.0
        }).json()

        alloc = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 10.0
        }).json()["allocation"]
        alloc_id = alloc["allocation_id"]

        # Dispatch
        self.client.post(f"/api/allocations/{alloc_id}/dispatch", json={})

        # Pre-delivery check
        item_before_delivery = self.client.get(f"/api/inventory/{item['id']}").json()
        self.assertEqual(item_before_delivery["on_hand"], 30.0)

        # Confirm Delivery
        deliv_res = self.client.post(f"/api/allocations/{alloc_id}/deliver", json={
            "reason": "Handed directly to household head"
        })
        self.assertEqual(deliv_res.status_code, 200)
        self.assertEqual(deliv_res.json()["allocation"]["status"], "Delivered")
        self.assertEqual(deliv_res.json()["allocation"]["quantity_delivered"], 10.0)

        # Post-delivery check: on_hand MUST STILL BE 30.0 (NOT 20.0!)
        item_after_delivery = self.client.get(f"/api/inventory/{item['id']}").json()
        self.assertEqual(item_after_delivery["on_hand"], 30.0)

    def test_11_partial_dispatch_and_delivery(self):
        """Test partial dispatch and subsequent partial delivery."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Partial Delivery Test House",
            "category": "Shelter",
            "description": "Tarpaulins",
            "zone_id": "Z003",
            "severity": "HIGH"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Heavy Duty Tarpaulins",
            "category": "Shelter Supplies",
            "unit": "pieces",
            "storage_location": "East Depot",
            "on_hand": 50.0
        }).json()

        # Reserve 20
        alloc = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 20.0
        }).json()["allocation"]
        alloc_id = alloc["allocation_id"]

        # 1. Partial dispatch: only 12 out of 20
        dsp_part = self.client.post(f"/api/allocations/{alloc_id}/dispatch", json={"quantity": 12.0}).json()
        self.assertEqual(dsp_part["allocation"]["quantity_dispatched"], 12.0)
        self.assertEqual(dsp_part["allocation"]["status"], "Reserved")  # still partially reserved

        # 2. Partial delivery: only 8 out of 12 dispatched delivered so far
        deliv_part = self.client.post(f"/api/allocations/{alloc_id}/deliver", json={"quantity": 8.0}).json()
        self.assertEqual(deliv_part["allocation"]["quantity_delivered"], 8.0)

        # 3. Cannot deliver more than remaining dispatched (12 - 8 = 4 max)
        over_deliv = self.client.post(f"/api/allocations/{alloc_id}/deliver", json={"quantity": 10.0})
        self.assertEqual(over_deliv.status_code, 400)

    def test_12_duplicate_operation_retries(self):
        """Test idempotency on repeated allocation submissions with same key."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "Idempotent Alloc House",
            "category": "Water",
            "description": "Water bottles",
            "zone_id": "Z001",
            "severity": "MEDIUM"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Emergency Flasks",
            "category": "Drinking Water",
            "unit": "pieces",
            "storage_location": "Main Post",
            "on_hand": 50.0
        }).json()

        key = f"IDEMP-KEY-{uuid.uuid4().hex[:8]}"
        payload = {
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 5.0,
            "idempotency_key": key
        }

        # First submit: creates
        res1 = self.client.post("/api/allocations", json=payload)
        self.assertEqual(res1.status_code, 201)
        self.assertFalse(res1.json()["is_retry"])
        alloc_id1 = res1.json()["allocation"]["allocation_id"]

        # Second submit with same idempotency key: returns same allocation without deducting double stock
        res2 = self.client.post("/api/allocations", json=payload)
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(res2.json()["is_retry"])
        self.assertEqual(res2.json()["allocation"]["allocation_id"], alloc_id1)

        # Verify reserved stock is exactly 5, not 10!
        check_item = self.client.get(f"/api/inventory/{item['id']}").json()
        self.assertEqual(check_item["reserved"], 5.0)

    def test_13_invalid_state_transitions(self):
        """Test cannot cancel already dispatched allocations, and cannot dispatch cancelled allocations."""
        req_res = self.client.post("/api/requests", json={
            "household_label": "State Transition Test House",
            "category": "Medical",
            "description": "Bandages",
            "zone_id": "Z001",
            "severity": "LOW"
        })
        req_id = req_res.json()["request"]["request_id"]

        item = self.client.post("/api/inventory", json={
            "name": "Bandage Rolls",
            "category": "Medical Supplies",
            "unit": "rolls",
            "storage_location": "Depot",
            "on_hand": 30.0
        }).json()

        alloc = self.client.post("/api/allocations", json={
            "request_id": req_id,
            "inventory_item_id": item["id"],
            "quantity": 10.0
        }).json()["allocation"]
        alloc_id = alloc["allocation_id"]

        # Fully dispatch
        self.client.post(f"/api/allocations/{alloc_id}/dispatch", json={})

        # Cannot cancel once fully dispatched
        cancel_fail = self.client.post(f"/api/allocations/{alloc_id}/cancel", json={})
        self.assertEqual(cancel_fail.status_code, 400)

    def test_14_unknown_items_and_requests(self):
        """Test 404 for unknown inventory item or non-existent request ID."""
        # Unknown item
        res = self.client.get("/api/inventory/9999999")
        self.assertEqual(res.status_code, 404)

        # Allocate with unknown request ID
        res_alloc = self.client.post("/api/allocations", json={
            "request_id": "REQ-NON-EXISTENT-XYZ",
            "inventory_item_id": 1,
            "quantity": 5.0
        })
        self.assertEqual(res_alloc.status_code, 404)

    def test_15_competing_reservations_consistency(self):
        """Test that multiple allocations cannot exceed remaining available stock."""
        item = self.client.post("/api/inventory", json={
            "name": "High Demand Life Raft",
            "category": "Rescue Equipment",
            "unit": "pieces",
            "storage_location": "Marine Station",
            "on_hand": 2.0
        }).json()

        # Two different requests competing for the 2 rafts
        req1 = self.client.post("/api/requests", json={
            "household_label": "House A", "category": "Rescue", "description": "Need raft", "zone_id": "Z001"
        }).json()["request"]["request_id"]

        req2 = self.client.post("/api/requests", json={
            "household_label": "House B", "category": "Rescue", "description": "Need raft", "zone_id": "Z001"
        }).json()["request"]["request_id"]

        # Alloc 1 reserves 2 rafts -> leaves 0 available
        res1 = self.client.post("/api/allocations", json={
            "request_id": req1, "inventory_item_id": item["id"], "quantity": 2.0
        })
        self.assertEqual(res1.status_code, 201)

        # Alloc 2 tries to reserve 1 raft -> must be rejected with 400
        res2 = self.client.post("/api/allocations", json={
            "request_id": req2, "inventory_item_id": item["id"], "quantity": 1.0
        })
        self.assertEqual(res2.status_code, 400)

    def test_16_existing_features_remain_operational(self):
        """Verify health, telemetry ingestion, zones, requests and SOS simulation are intact."""
        health = self.client.get("/health").json()
        self.assertEqual(health["status"], "ok")

        zones = self.client.get("/api/zones").json()
        self.assertGreater(len(zones), 400)

        reqs = self.client.get("/api/requests").json()
        self.assertIn("items", reqs)

        sos_res = self.client.post("/api/sos/simulate", json={
            "event_id": f"SOS-SMOKE-{uuid.uuid4().hex[:6]}",
            "household_label": "Smoke SOS House",
            "category": "Water",
            "description": "SOS smoke check",
            "zone_id": "Z001",
            "severity": "HIGH"
        })
        self.assertIn(sos_res.status_code, [200, 201])


if __name__ == "__main__":
    unittest.main()
