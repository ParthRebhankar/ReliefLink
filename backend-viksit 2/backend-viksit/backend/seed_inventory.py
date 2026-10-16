"""Seed synthetic demonstration relief inventory and stock for FloodGuard.

Safe and idempotent:
- Only seeds demo inventory items if they do not already exist.
- Does not wipe or overwrite user-created items.
- In production, do not run this script or set FLOODGUARD_ENV=production.
"""

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

DATABASE = Path(os.getenv("FLOODGUARD_DB", Path(__file__).parent / "floodguard.db"))


def connection():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def seed_inventory():
    if os.getenv("FLOODGUARD_ENV", "").lower() == "production":
        print("FLOODGUARD_ENV is set to production. Skipping demo inventory seeding.")
        return

    from app import initialise_database, _seed_demo_inventory
    initialise_database()

    with closing(connection()) as db:
        _seed_demo_inventory(db)
        db.commit()
        count = db.execute("SELECT COUNT(*) AS c FROM inventory_items").fetchone()["c"]
        alloc_count = db.execute("SELECT COUNT(*) AS c FROM allocations").fetchone()["c"]
        mov_count = db.execute("SELECT COUNT(*) AS c FROM stock_movements").fetchone()["c"]

    print("=======================================================")
    print("      FLOODGUARD RELIEF INVENTORY SEED COMPLETE        ")
    print("=======================================================")
    print(f"Total Inventory Items : {count}")
    print(f"Total Allocations     : {alloc_count}")
    print(f"Total Stock Movements : {mov_count}")
    print("=======================================================")


if __name__ == "__main__":
    seed_inventory()
