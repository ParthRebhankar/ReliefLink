"""
Seed script for FloodGuard Phase 3 Response Teams and Volunteers.
Safe to run multiple times (idempotent).
"""

import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DATABASE = BACKEND_DIR / "floodguard.db"

sys.path.insert(0, str(BACKEND_DIR))
from app import _seed_demo_teams_and_volunteers, connection


def main():
    print(f"[FloodGuard Phase 3] Seeding demo response teams and volunteers into: {DATABASE}")
    with connection() as db:
        _seed_demo_teams_and_volunteers(db)
        db.commit()
        t_count = db.execute("SELECT COUNT(*) AS c FROM response_teams").fetchone()["c"]
        v_count = db.execute("SELECT COUNT(*) AS c FROM volunteers").fetchone()["c"]
        print(f"[FloodGuard Phase 3] Successfully seeded: {t_count} teams, {v_count} volunteers.")


if __name__ == "__main__":
    main()
