import unittest
import uuid
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app import app, connection


class TestVolunteerCoordination(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        # Prepare fresh test verified emergency request, unverified emergency request, and test team/volunteers
        with connection() as db:
            now = datetime.now(timezone.utc).isoformat()
            self.verified_req_id = f"REQ-TEST-VER-{uuid.uuid4().hex[:6].upper()}"
            self.unverified_req_id = f"REQ-TEST-UNV-{uuid.uuid4().hex[:6].upper()}"

            db.execute(
                """INSERT INTO emergency_requests 
                   (request_id, household_label, category, description, zone_id, severity, verification_status, status, created_at, updated_at)
                   VALUES (?, 'Test Verified Household', 'Food', 'Urgent food rations needed', 'Z001', 'HIGH', 'Verified', 'Verified', ?, ?)""",
                (self.verified_req_id, now, now)
            )

            db.execute(
                """INSERT INTO emergency_requests 
                   (request_id, household_label, category, description, zone_id, severity, verification_status, status, created_at, updated_at)
                   VALUES (?, 'Test Unverified Household', 'Rescue', 'Boat rescue needed', 'Z002', 'CRITICAL', 'Pending Verification', 'Pending Verification', ?, ?)""",
                (self.unverified_req_id, now, now)
            )

            # Test team (available)
            self.test_team_id = f"TEAM-TEST-{uuid.uuid4().hex[:4].upper()}"
            db.execute(
                """INSERT INTO response_teams 
                   (team_id, name, team_type, skills, equipment, availability_status, base_location, last_known_location, created_at, updated_at)
                   VALUES (?, 'Test Rescue Unit', 'Water Rescue', 'Water Rescue, CPR', 'Inflatable Boat', 'Available', 'West Station', 'West Station (Synthetic Demo)', ?, ?)""",
                (self.test_team_id, now, now)
            )

            # Test team (offline)
            self.offline_team_id = f"TEAM-OFF-{uuid.uuid4().hex[:4].upper()}"
            db.execute(
                """INSERT INTO response_teams 
                   (team_id, name, team_type, skills, equipment, availability_status, base_location, last_known_location, created_at, updated_at)
                   VALUES (?, 'Offline Unit', 'Logistics', 'Driving', 'Truck', 'Offline', 'Base', 'Base (Synthetic Demo)', ?, ?)""",
                (self.offline_team_id, now, now)
            )

            # Test volunteer (available)
            self.test_vol_id = f"VOL-TEST-{uuid.uuid4().hex[:4].upper()}"
            db.execute(
                """INSERT INTO volunteers
                   (volunteer_id, name, contact, skills, availability_status, current_zone, last_known_location, created_at, updated_at)
                   VALUES (?, 'Test Volunteer Alpha', '+91 99999 11111', 'First Aid', 'Available', 'Sitabuldi', 'Sitabuldi (Synthetic Demo)', ?, ?)""",
                (self.test_vol_id, now, now)
            )

            # Test volunteer (offline)
            self.offline_vol_id = f"VOL-OFF-{uuid.uuid4().hex[:4].upper()}"
            db.execute(
                """INSERT INTO volunteers
                   (volunteer_id, name, contact, skills, availability_status, current_zone, last_known_location, created_at, updated_at)
                   VALUES (?, 'Test Volunteer Offline', '+91 99999 22222', 'Logistics', 'Offline', 'Dharampeth', 'Dharampeth (Synthetic Demo)', ?, ?)""",
                (self.offline_vol_id, now, now)
            )

            # Test inventory item & allocation for delivery testing
            self.item_code = f"INV-TEST-{uuid.uuid4().hex[:6].upper()}"
            cur = db.execute(
                """INSERT INTO inventory_items
                   (item_code, name, category, unit, storage_location, on_hand, reserved, low_stock_threshold, created_at, updated_at)
                   VALUES (?, 'Test Food Rations', 'Food', 'packets', 'Main Depot', 100.0, 10.0, 20.0, ?, ?)""",
                (self.item_code, now, now)
            )
            item_id = cur.lastrowid
            self.alloc_id = f"ALC-TEST-{uuid.uuid4().hex[:6].upper()}"
            db.execute(
                """INSERT INTO allocations
                   (allocation_id, request_id, inventory_item_id, quantity_reserved, quantity_dispatched, quantity_delivered, status, created_at, updated_at)
                   VALUES (?, ?, ?, 10.0, 0.0, 0.0, 'Reserved', ?, ?)""",
                (self.alloc_id, self.verified_req_id, item_id, now, now)
            )

            db.commit()

    def test_01_cannot_assign_unverified_request_without_override(self):
        """Rule 1: Only verified requests can receive operational assignments without an authorized override."""
        payload = {
            "request_id": self.unverified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Rescue",
            "task_description": "Evacuate flooded household",
            "priority": "Critical",
            "destination": "Z002 North Sector",
            "emergency_override": False
        }
        res = self.client.post("/api/assignments", json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Only verified requests can receive operational assignments", res.json()["detail"])

    def test_02_assign_unverified_request_with_authorized_override(self):
        """Rule 1: An authorized emergency override with mandatory audit reason allows unverified assignment."""
        payload = {
            "request_id": self.unverified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Rescue",
            "task_description": "Immediate life threat reported; life safety override authorized",
            "priority": "Critical",
            "destination": "Z002 North Sector",
            "emergency_override": True,
            "override_reason": "Life-safety exception authorized by Disaster Response Director due to rapid water rise"
        }
        res = self.client.post("/api/assignments", json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["status"], "Assigned")
        self.assertEqual(data["override_reason"], payload["override_reason"])
        # Check team availability changed to 'Assigned'
        with connection() as db:
            t_row = db.execute("SELECT availability_status FROM response_teams WHERE team_id = ?", (self.test_team_id,)).fetchone()
            self.assertEqual(t_row["availability_status"], "Assigned")

    def test_03_cannot_assign_offline_team_or_volunteer(self):
        """Rule 7: Do not assign an offline volunteer or team as if they were available."""
        # Try offline team
        payload1 = {
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.offline_team_id,
            "task_type": "Delivery",
            "task_description": "Transport ration packets",
            "priority": "High",
            "destination": "Z001 Center"
        }
        res1 = self.client.post("/api/assignments", json=payload1)
        self.assertEqual(res1.status_code, 400)
        self.assertIn("offline", res1.json()["detail"].lower())

        # Try offline volunteer
        payload2 = {
            "request_id": self.verified_req_id,
            "assignee_type": "Volunteer",
            "assignee_id": self.offline_vol_id,
            "task_type": "Delivery",
            "task_description": "First aid delivery",
            "priority": "Medium",
            "destination": "Z001 Center"
        }
        res2 = self.client.post("/api/assignments", json=payload2)
        self.assertEqual(res2.status_code, 400)
        self.assertIn("offline", res2.json()["detail"].lower())

    def test_04_cannot_assign_busy_or_already_assigned_member(self):
        """Rule 2: A volunteer or team cannot receive conflicting active assignments."""
        payload = {
            "request_id": self.verified_req_id,
            "assignee_type": "Volunteer",
            "assignee_id": self.test_vol_id,
            "task_type": "Delivery",
            "task_description": "First delivery task",
            "priority": "High",
            "destination": "Z001 Center"
        }
        res1 = self.client.post("/api/assignments", json=payload)
        self.assertEqual(res1.status_code, 201)

        # Attempt to create conflicting second task while first is active
        payload_conflicting = {
            "request_id": self.verified_req_id,
            "assignee_type": "Volunteer",
            "assignee_id": self.test_vol_id,
            "task_type": "Medical Support",
            "task_description": "Conflicting second task",
            "priority": "High",
            "destination": "Z001 Center"
        }
        res2 = self.client.post("/api/assignments", json=payload_conflicting)
        self.assertEqual(res2.status_code, 400)
        self.assertIn("active assignment", res2.json()["detail"].lower())

    def test_05_prevent_duplicate_active_assignments_for_same_allocation(self):
        """Rule 3: Prevent duplicate active assignments for the same delivery task/allocation."""
        payload1 = {
            "request_id": self.verified_req_id,
            "assignee_type": "Volunteer",
            "assignee_id": self.test_vol_id,
            "task_type": "Delivery",
            "task_description": "Dispatch rations for allocation",
            "priority": "High",
            "destination": "Sitabuldi Household 4",
            "allocation_id": self.alloc_id
        }
        res1 = self.client.post("/api/assignments", json=payload1)
        self.assertEqual(res1.status_code, 201)

        # Create another available volunteer
        vol2_id = f"VOL-EXTRA-{uuid.uuid4().hex[:4].upper()}"
        with connection() as db:
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """INSERT INTO volunteers (volunteer_id, name, availability_status, created_at, updated_at)
                   VALUES (?, 'Extra Volunteer', 'Available', ?, ?)""",
                (vol2_id, now, now)
            )
            db.commit()

        # Attempt to assign the same allocation to a second volunteer while active
        payload2 = {
            "request_id": self.verified_req_id,
            "assignee_type": "Volunteer",
            "assignee_id": vol2_id,
            "task_type": "Delivery",
            "task_description": "Duplicate delivery of same allocation",
            "priority": "High",
            "destination": "Sitabuldi Household 4",
            "allocation_id": self.alloc_id
        }
        res2 = self.client.post("/api/assignments", json=payload2)
        self.assertEqual(res2.status_code, 400)
        self.assertIn("already exists for relief allocation", res2.json()["detail"].lower())

    def test_06_explicit_task_lifecycle_transitions(self):
        """Rule 9 & Lifecycle: Assigned -> Accepted -> En Route -> Arrived -> Completed."""
        payload = {
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Delivery",
            "task_description": "Delivery of clean water cans",
            "priority": "High",
            "destination": "Z001 Ward 14"
        }
        res = self.client.post("/api/assignments", json=payload)
        self.assertEqual(res.status_code, 201)
        asn_id = res.json()["assignment_id"]

        # 1. Accept
        res_accept = self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Accept", "note": "Team captain accepted task"})
        self.assertEqual(res_accept.status_code, 200)
        self.assertEqual(res_accept.json()["assignment"]["status"], "Accepted")

        # 2. En Route
        res_enroute = self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "En Route", "note": "Team left depot on rescue truck"})
        self.assertEqual(res_enroute.status_code, 200)
        self.assertEqual(res_enroute.json()["assignment"]["status"], "En Route")

        # 3. Arrived
        res_arrive = self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Arrive", "note": "Vehicle arrived at location"})
        self.assertEqual(res_arrive.status_code, 200)
        self.assertEqual(res_arrive.json()["assignment"]["status"], "Arrived")

        # 4. Complete
        res_comp = self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Complete", "note": "All packages handed over successfully"})
        self.assertEqual(res_comp.status_code, 200)
        self.assertEqual(res_comp.json()["assignment"]["status"], "Completed")

        # Verify assignee availability status is restored to 'Available'
        with connection() as db:
            team_row = db.execute("SELECT availability_status FROM response_teams WHERE team_id = ?", (self.test_team_id,)).fetchone()
            self.assertEqual(team_row["availability_status"], "Available")

        # Check events history has all 5 events
        events_res = self.client.get(f"/api/assignments/{asn_id}/events")
        self.assertEqual(events_res.status_code, 200)
        events = events_res.json()["events"]
        self.assertEqual(len(events), 5)
        actions = [e["action"] for e in events]
        self.assertEqual(actions, ["Created", "Accept", "En route", "Arrive", "Complete"])

    def test_07_completing_task_does_not_mark_supplies_delivered_or_request_fulfilled(self):
        """Rule 6: Completing an assignment must not automatically mark all requested supplies delivered."""
        payload = {
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Delivery",
            "task_description": "Delivery mission",
            "priority": "Medium",
            "destination": "Sitabuldi Area",
            "allocation_id": self.alloc_id
        }
        res = self.client.post("/api/assignments", json=payload)
        asn_id = res.json()["assignment_id"]

        # Move to complete directly
        self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Accept"})
        self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "En Route"})
        self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Arrive"})
        self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Complete", "note": "Handed over"})

        with connection() as db:
            # Allocation delivered quantity must NOT have automatically jumped to 10.0!
            alloc = db.execute("SELECT quantity_delivered, status FROM allocations WHERE allocation_id = ?", (self.alloc_id,)).fetchone()
            self.assertEqual(alloc["quantity_delivered"], 0.0)
            self.assertEqual(alloc["status"], "Reserved")

            # Emergency request must still be in its existing state, NOT marked 'Fulfilled'
            req = db.execute("SELECT status FROM emergency_requests WHERE request_id = ?", (self.verified_req_id,)).fetchone()
            self.assertNotEqual(req["status"], "Fulfilled")

    def test_08_cancelling_task_requires_reason_and_releases_assignee_without_erasing_request(self):
        """Rule 5: A cancelled assignment must not erase the underlying request or allocation, and frees the assignee."""
        payload = {
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Delivery",
            "task_description": "Supply delivery",
            "priority": "Medium",
            "destination": "Sitabuldi Area",
            "allocation_id": self.alloc_id
        }
        res = self.client.post("/api/assignments", json=payload)
        asn_id = res.json()["assignment_id"]

        # Cancel without reason should fail
        res_no_reason = self.client.post(f"/api/assignments/{asn_id}/action", json={"action": "Cancel", "reason": ""})
        self.assertEqual(res_no_reason.status_code, 400)

        # Cancel with reason succeeds
        res_cancel = self.client.post(f"/api/assignments/{asn_id}/action", json={
            "action": "Cancel",
            "reason": "Road submerged by 1.2m of water; vehicle unable to cross safely"
        })
        self.assertEqual(res_cancel.status_code, 200)
        self.assertEqual(res_cancel.json()["assignment"]["status"], "Cancelled")

        # Assignee released
        with connection() as db:
            team_row = db.execute("SELECT availability_status FROM response_teams WHERE team_id = ?", (self.test_team_id,)).fetchone()
            self.assertEqual(team_row["availability_status"], "Available")

            # Emergency request and allocation still exist intact
            req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (self.verified_req_id,)).fetchone()
            self.assertIsNotNone(req)

            alloc = db.execute("SELECT * FROM allocations WHERE allocation_id = ?", (self.alloc_id,)).fetchone()
            self.assertIsNotNone(alloc)

    def test_09_multiple_linked_tasks_for_same_request(self):
        """Rule 4: If a task needs multiple teams, represent this as multiple linked tasks on the same request."""
        # Create second team
        team2_id = f"TEAM-TWO-{uuid.uuid4().hex[:4].upper()}"
        with connection() as db:
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """INSERT INTO response_teams (team_id, name, availability_status, created_at, updated_at)
                   VALUES (?, 'Secondary Unit', 'Available', ?, ?)""",
                (team2_id, now, now)
            )
            db.commit()

        # Task 1 for team 1
        res1 = self.client.post("/api/assignments", json={
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": self.test_team_id,
            "task_type": "Evacuation",
            "task_description": "Evacuate ground floor elderly residents",
            "priority": "Critical",
            "destination": "Sitabuldi Wing A"
        })
        self.assertEqual(res1.status_code, 201)

        # Task 2 for team 2
        res2 = self.client.post("/api/assignments", json={
            "request_id": self.verified_req_id,
            "assignee_type": "Team",
            "assignee_id": team2_id,
            "task_type": "Medical Support",
            "task_description": "Provide triage for injured family members",
            "priority": "High",
            "destination": "Sitabuldi Wing B"
        })
        self.assertEqual(res2.status_code, 201)

        # Fetch request detail and ensure both assignments are present
        req_res = self.client.get(f"/api/requests/{self.verified_req_id}")
        self.assertEqual(req_res.status_code, 200)
        assignments = req_res.json()["assignments"]
        assigned_ids = [a["assignee_id"] for a in assignments]
        self.assertIn(self.test_team_id, assigned_ids)
        self.assertIn(team2_id, assigned_ids)


if __name__ == "__main__":
    unittest.main()
