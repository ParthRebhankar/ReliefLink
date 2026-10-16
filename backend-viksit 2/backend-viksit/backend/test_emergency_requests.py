"""Comprehensive test suite for FloodGuard API and Emergency Requests & SOS module."""

import unittest
from fastapi.testclient import TestClient
from app import app, initialise_database, connection


class TestEmergencyRequestsAndCore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialise_database()
        cls.client = TestClient(app)

    def test_01_core_health_and_zones(self):
        """Verify existing core endpoints remain functional."""
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertGreater(data["zones_loaded"], 0)

        res = self.client.get("/api/zones")
        self.assertEqual(res.status_code, 200)
        zones = res.json()
        self.assertIsInstance(zones, list)
        self.assertTrue(any(z["zone_id"] == "Z001" for z in zones))

    def test_02_core_reading_ingest(self):
        """Verify existing sensor reading ingestion remains functional."""
        payload = {
            "device_id": "esp32-unit-test",
            "zone_id": "Z001",
            "water_level_cm": 35.0,
            "rainfall_24h_mm": 20.0,
            "local_status": "DANGER"
        }
        res = self.client.post("/api/readings", json=payload)
        self.assertEqual(res.status_code, 201)
        pred = res.json()
        self.assertEqual(pred["zone_id"], "Z001")
        self.assertIn(pred["risk_level"], ["SAFE", "WARNING", "DANGER", "CRITICAL"])

        res_latest = self.client.get("/api/zones/Z001/latest")
        self.assertEqual(res_latest.status_code, 200)

    def test_03_create_emergency_request_success(self):
        """Test successful request creation via web form."""
        payload = {
            "household_label": "Test Household 55, Ward 11",
            "category": "Water",
            "description": "Drinking water filter broken due to backflow",
            "quantity": "20L",
            "zone_id": "Z001",
            "severity": "MEDIUM",
            "latitude": 21.145,
            "longitude": 79.088,
            "coordinator_notes": "Call citizen before delivery"
        }
        res = self.client.post("/api/requests", json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertIn("request", data)
        self.assertIn("history", data)
        req = data["request"]
        self.assertTrue(req["request_id"].startswith("REQ-"))
        self.assertEqual(req["household_label"], "Test Household 55, Ward 11")
        self.assertEqual(req["category"], "Water")
        self.assertEqual(req["verification_status"], "Pending Verification")
        self.assertEqual(req["status"], "Pending Verification")
        self.assertEqual(req["source"], "web_form")
        self.assertGreater(req["priority_score"], 0)
        self.assertEqual(len(data["history"]), 1)
        self.assertEqual(data["history"][0]["action"], "CREATED")

    def test_04_create_emergency_request_invalid_input(self):
        """Test validation on invalid category, missing fields, or invalid zone."""
        # Invalid zone
        res = self.client.post("/api/requests", json={
            "household_label": "Bad Zone House",
            "category": "Rescue",
            "description": "Stranded",
            "zone_id": "Z999999_NON_EXISTENT",
        })
        self.assertEqual(res.status_code, 400)

        # Invalid category
        res = self.client.post("/api/requests", json={
            "household_label": "Bad Cat House",
            "category": "GoldDelivery",
            "description": "Send gold",
            "zone_id": "Z001",
        })
        self.assertEqual(res.status_code, 422)

        # Missing required description
        res = self.client.post("/api/requests", json={
            "household_label": "Empty House",
            "category": "Food",
            "zone_id": "Z001",
        })
        self.assertEqual(res.status_code, 422)

    def test_05_list_and_filter_requests(self):
        """Test listing and filtering requests by category, status, severity, zone, search."""
        res = self.client.get("/api/requests")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("items", data)
        self.assertIn("counts", data)
        self.assertGreater(data["total"], 0)

        # Filter by category
        res_rescue = self.client.get("/api/requests?category=Rescue")
        self.assertEqual(res_rescue.status_code, 200)
        for item in res_rescue.json()["items"]:
            self.assertEqual(item["category"], "Rescue")

        # Filter by zone
        res_zone = self.client.get("/api/requests?zone_id=Z001")
        self.assertEqual(res_zone.status_code, 200)
        for item in res_zone.json()["items"]:
            self.assertEqual(item["zone_id"], "Z001")

        # Search by household label
        res_search = self.client.get("/api/requests?search=Sitabuldi")
        self.assertEqual(res_search.status_code, 200)
        items = res_search.json()["items"]
        self.assertTrue(any("Sitabuldi" in i["household_label"] for i in items))

    def test_06_get_request_by_id_and_unknown(self):
        """Test fetching a request by ID and handling unknown request ID."""
        # Fetch an existing one first
        res = self.client.get("/api/requests?limit=1")
        items = res.json()["items"]
        self.assertTrue(len(items) > 0)
        req_id = items[0]["request_id"]

        res_detail = self.client.get(f"/api/requests/{req_id}")
        self.assertEqual(res_detail.status_code, 200)
        data = res_detail.json()
        self.assertEqual(data["request"]["request_id"], req_id)
        self.assertIsInstance(data["history"], list)

        # Unknown ID returns 404
        res_404 = self.client.get("/api/requests/REQ-NON-EXISTENT-XYZ")
        self.assertEqual(res_404.status_code, 404)

    def test_07_verification_and_status_changes_with_audit(self):
        """Test verifying, advancing status, rejecting with reason, and history records."""
        # Create a fresh request
        res = self.client.post("/api/requests", json={
            "household_label": "Audit Test House, Ward 7",
            "category": "Medical",
            "description": "Emergency inhaler and oxygen cylinder needed",
            "zone_id": "Z001",
            "severity": "HIGH",
        })
        req_id = res.json()["request"]["request_id"]

        # 1. Verify the request (verification_status -> 'Verified')
        res_verify = self.client.patch(f"/api/requests/{req_id}", json={
            "verification_status": "Verified",
            "changed_by": "Coordinator Ananya",
            "change_reason": "Verified patient medical certificate via WhatsApp"
        })
        self.assertEqual(res_verify.status_code, 200)
        v_data = res_verify.json()
        self.assertEqual(v_data["request"]["verification_status"], "Verified")
        # Fulfilment status should be 'Verified', NOT 'Fulfilled'
        self.assertEqual(v_data["request"]["status"], "Verified")
        self.assertEqual(v_data["history"][-1]["action"], "VERIFIED")
        self.assertEqual(v_data["history"][-1]["changed_by"], "Coordinator Ananya")

        # 2. Advance status to 'Assigned'
        res_assign = self.client.patch(f"/api/requests/{req_id}", json={
            "status": "Assigned",
            "coordinator_notes": "Assigned to Medical Response Team Bravo",
            "changed_by": "Dispatcher Verma",
            "change_reason": "Assigned to ambulance crew"
        })
        self.assertEqual(res_assign.status_code, 200)
        self.assertEqual(res_assign.json()["request"]["status"], "Assigned")

        # 3. Advance to 'In Progress'
        res_prog = self.client.patch(f"/api/requests/{req_id}", json={
            "status": "In Progress",
            "changed_by": "Medic Team",
            "change_reason": "En route with oxygen pack"
        })
        self.assertEqual(res_prog.status_code, 200)
        self.assertEqual(res_prog.json()["request"]["status"], "In Progress")

        # 4. Advance to 'Fulfilled'
        res_ful = self.client.patch(f"/api/requests/{req_id}", json={
            "status": "Fulfilled",
            "changed_by": "Medic Team",
            "change_reason": "Delivered to patient"
        })
        self.assertEqual(res_ful.status_code, 200)
        self.assertEqual(res_ful.json()["request"]["status"], "Fulfilled")
        self.assertEqual(res_ful.json()["request"]["verification_status"], "Verified")

    def test_08_reject_requires_reason(self):
        """Test rejecting a request requires a reason and updates both statuses."""
        res = self.client.post("/api/requests", json={
            "household_label": "Reject Test House",
            "category": "Food",
            "description": "Need snacks",
            "zone_id": "Z002",
            "severity": "LOW",
        })
        req_id = res.json()["request"]["request_id"]

        # Rejecting without reason should fail (400)
        res_rej_fail = self.client.patch(f"/api/requests/{req_id}", json={
            "verification_status": "Rejected",
            "rejection_reason": ""
        })
        self.assertEqual(res_rej_fail.status_code, 400)

        # Rejecting with reason succeeds
        res_rej = self.client.patch(f"/api/requests/{req_id}", json={
            "verification_status": "Rejected",
            "rejection_reason": "Not a flood emergency; commercial enterprise"
        })
        self.assertEqual(res_rej.status_code, 200)
        data = res_rej.json()
        self.assertEqual(data["request"]["verification_status"], "Rejected")
        self.assertEqual(data["request"]["status"], "Rejected")
        self.assertEqual(data["request"]["rejection_reason"], "Not a flood emergency; commercial enterprise")

    def test_09_sos_simulation_and_idempotency(self):
        """Test simulating an SOS event and idempotency on duplicate event retries."""
        import uuid
        event_id = f"SOS-TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "event_id": event_id,
            "household_label": "Demo Family #99 - Zone 1 North",
            "category": "Rescue",
            "description": "Water reached waist level on ground floor, 3 people trapped",
            "quantity": "3 persons",
            "zone_id": "Z001",
            "severity": "CRITICAL",
            "coordinator_notes": "Automated SOS beacon trigger"
        }

        # First dispatch: creates request
        res1 = self.client.post("/api/sos/simulate", json=payload)
        self.assertEqual(res1.status_code, 201)
        data1 = res1.json()
        self.assertEqual(data1["event_id"], event_id)
        self.assertFalse(data1["is_retry"])
        self.assertTrue(data1["acknowledged"])
        created_req_id = data1["request"]["request_id"]
        self.assertEqual(data1["request"]["source"], "simulated_sos")

        # Second dispatch with identical event_id: must return same request idempotently
        res2 = self.client.post("/api/sos/simulate", json=payload)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["event_id"], event_id)
        self.assertTrue(data2["is_retry"])
        self.assertEqual(data2["request"]["request_id"], created_req_id)

    def test_10_duplicate_detection_flagging(self):
        """Test that requests with matching active households are flagged for human review."""
        h_label = "Unique Duplicate Household Label #4242"
        # Create initial request
        self.client.post("/api/requests", json={
            "household_label": h_label,
            "category": "Shelter",
            "description": "Initial shelter request",
            "zone_id": "Z001",
            "severity": "HIGH",
        })

        # Submit another request for the same household
        res_dup = self.client.post("/api/requests", json={
            "household_label": h_label,
            "category": "Shelter",
            "description": "Second shelter request from same house",
            "zone_id": "Z001",
            "severity": "HIGH",
        })
        self.assertEqual(res_dup.status_code, 201)
        req = res_dup.json()["request"]
        self.assertEqual(req["is_possible_duplicate"], 1)
        self.assertTrue(len(req["duplicate_notes"]) > 0)


if __name__ == "__main__":
    unittest.main()
