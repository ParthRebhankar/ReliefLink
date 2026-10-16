"""
Seed script for FloodGuard Phase 4 Relief Intelligence Demo Scenario.
Safe to run multiple times (idempotent).
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DATABASE = BACKEND_DIR / "floodguard.db"

sys.path.insert(0, str(BACKEND_DIR))
from app import _seed_demo_intelligence, connection, initialise_database


def main():
    print(f"[FloodGuard Phase 4] Initialising database & seeding demo relief intelligence into: {DATABASE}")
    initialise_database()
    with connection() as db:
        _seed_demo_intelligence(db)
        db.commit()
        req_count = db.execute("SELECT COUNT(*) AS c FROM emergency_requests").fetchone()["c"]
        prio_count = db.execute("SELECT COUNT(*) AS c FROM priority_overrides").fetchone()["c"]
        print(f"[FloodGuard Phase 4] Successfully seeded demo records: {req_count} requests, {prio_count} overrides.")


if __name__ == "__main__":
    main()
