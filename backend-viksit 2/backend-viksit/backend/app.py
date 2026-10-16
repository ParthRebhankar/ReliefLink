"""FloodGuard API: ESP32 ingestion and live flood-risk status."""

import csv
import io
import json
import os
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from statistics import median
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GEO_RISK_CSV = ROOT / "viksit/nagpur_floodguard_deliverables (3)/risk_features.csv"
GEO_RISK_CSV = Path(os.getenv("FLOODGUARD_RISK_FEATURES", DEFAULT_GEO_RISK_CSV))
DEFAULT_RAINFALL_CSV = ROOT / "viksit/NEW_floodguard_real_evidence_package/historical_rainfall_nagpur.csv"
RAINFALL_CSV = Path(os.getenv("FLOODGUARD_RAINFALL_HISTORY", DEFAULT_RAINFALL_CSV))
DATABASE = Path(os.getenv("FLOODGUARD_DB", Path(__file__).parent / "floodguard.db"))
DEVICE_API_KEY = os.getenv("FLOODGUARD_DEVICE_API_KEY")
# ponytail: prototype sensor arm sits 50 cm above the drain bottom (firmware SENSOR_HEIGHT);
# upgrade path is per-device config when mounts vary.
SENSOR_RANGE_CM = 50.0
# Firmware alarm bands as a fraction of sensor range: 15/22/25 cm on a 50 cm arm.
WATER_ALARM_BANDS = ((0.50, "CRITICAL"), (0.44, "DANGER"), (0.30, "WARNING"))

app = FastAPI(title="FloodGuard API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FLOODGUARD_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReadingIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    zone_id: str = Field(min_length=1, max_length=30)
    water_level_cm: float = Field(ge=0, le=100000)
    rainfall_24h_mm: float = Field(default=0, ge=0, le=10000)
    local_status: str | None = Field(default=None, max_length=20)
    timestamp: datetime | None = None


class RequestCategory(str, Enum):
    WATER = "Water"
    FOOD = "Food"
    MEDICAL = "Medical"
    RESCUE = "Rescue"
    SHELTER = "Shelter"


class RequestSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class VerificationStatus(str, Enum):
    PENDING = "Pending Verification"
    VERIFIED = "Verified"
    REJECTED = "Rejected"


class FulfilmentStatus(str, Enum):
    PENDING_VERIFICATION = "Pending Verification"
    VERIFIED = "Verified"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    FULFILLED = "Fulfilled"
    REJECTED = "Rejected"


class EmergencyRequestCreate(BaseModel):
    household_label: str = Field(min_length=1, max_length=150)
    category: RequestCategory
    description: str = Field(min_length=1, max_length=1000)
    quantity: str | None = Field(default="", max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    zone_id: str = Field(min_length=1, max_length=30)
    severity: RequestSeverity = RequestSeverity.MEDIUM
    coordinator_notes: str | None = Field(default="", max_length=1000)
    source: str = Field(default="web_form", max_length=50)


class EmergencyRequestUpdate(BaseModel):
    verification_status: VerificationStatus | None = None
    status: FulfilmentStatus | None = None
    rejection_reason: str | None = Field(default=None, max_length=500)
    coordinator_notes: str | None = Field(default=None, max_length=1000)
    severity: RequestSeverity | None = None
    changed_by: str | None = Field(default="Operator", max_length=100)
    change_reason: str | None = Field(default=None, max_length=500)


class SOSSimulateIn(BaseModel):
    event_id: str | None = Field(default=None, min_length=1, max_length=100)
    household_label: str = Field(min_length=1, max_length=150)
    category: RequestCategory
    description: str = Field(min_length=1, max_length=1000)
    quantity: str | None = Field(default="", max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    zone_id: str = Field(min_length=1, max_length=30)
    severity: RequestSeverity = RequestSeverity.CRITICAL
    coordinator_notes: str | None = Field(default="Simulated emergency SOS trigger", max_length=1000)


# ---------------------------------------------------------------------------
# Relief Inventory Models
# ---------------------------------------------------------------------------

class InventoryCategory(str, Enum):
    FOOD = "Food"
    WATER = "Drinking Water"
    MEDICAL = "Medical Supplies"
    RESCUE = "Rescue Equipment"
    SHELTER = "Shelter Supplies"
    OTHER = "Other"


class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category: InventoryCategory
    unit: str = Field(min_length=1, max_length=30)
    storage_location: str = Field(min_length=1, max_length=150)
    on_hand: float = Field(default=0.0, ge=0)
    low_stock_threshold: float = Field(default=10.0, ge=0)
    item_code: str | None = Field(default=None, max_length=50)


class InventoryItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    category: InventoryCategory | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    storage_location: str | None = Field(default=None, min_length=1, max_length=150)
    low_stock_threshold: float | None = Field(default=None, ge=0)


class StockReceiveIn(BaseModel):
    quantity: float = Field(gt=0)
    reason: str | None = Field(default="Incoming stock receipt", max_length=300)
    reference: str | None = Field(default="", max_length=100)
    operator: str | None = Field(default="Inventory Operator", max_length=100)
    idempotency_key: str | None = Field(default=None, max_length=100)


class StockAdjustIn(BaseModel):
    new_on_hand: float = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)
    operator: str | None = Field(default="Inventory Coordinator", max_length=100)


class AllocationCreateIn(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    inventory_item_id: int = Field(gt=0)
    quantity: float = Field(gt=0)
    allocated_by: str | None = Field(default="Relief Coordinator", max_length=100)
    notes: str | None = Field(default="", max_length=500)
    idempotency_key: str | None = Field(default=None, max_length=100)


class AllocationActionIn(BaseModel):
    quantity: float | None = Field(default=None, gt=0)
    reason: str | None = Field(default="", max_length=500)
    operator: str | None = Field(default="Relief Coordinator", max_length=100)
    idempotency_key: str | None = Field(default=None, max_length=100)


# ---------------------------------------------------------------------------
# Phase 3: Volunteers, Response Teams, and Task Assignments Models
# ---------------------------------------------------------------------------

class AvailabilityStatus(str, Enum):
    AVAILABLE = "Available"
    ASSIGNED = "Assigned"
    BUSY = "Busy"
    OFFLINE = "Offline"


class AssigneeType(str, Enum):
    TEAM = "Team"
    VOLUNTEER = "Volunteer"


class TaskPriority(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class TaskStatus(str, Enum):
    PENDING_ASSIGNMENT = "Pending Assignment"
    ASSIGNED = "Assigned"
    ACCEPTED = "Accepted"
    EN_ROUTE = "En Route"
    ARRIVED = "Arrived"
    COMPLETED = "Completed"
    CANCELLED = "Cancelled"


class ResponseTeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    team_type: str = Field(default="Rescue & Evacuation", max_length=100)
    skills: str = Field(default="", max_length=500)
    equipment: str = Field(default="", max_length=500)
    base_location: str = Field(default="Central Depot - Sitabuldi", max_length=200)
    leader_name: str = Field(default="", max_length=100)
    contact_number: str = Field(default="", max_length=50)
    team_id: str | None = Field(default=None, max_length=50)


class ResponseTeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    team_type: str | None = Field(default=None, max_length=100)
    skills: str | None = Field(default=None, max_length=500)
    equipment: str | None = Field(default=None, max_length=500)
    base_location: str | None = Field(default=None, max_length=200)
    leader_name: str | None = Field(default=None, max_length=100)
    contact_number: str | None = Field(default=None, max_length=50)
    availability_status: AvailabilityStatus | None = None


class VolunteerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    contact: str = Field(default="", max_length=50)
    team_id: str | None = Field(default=None, max_length=50)
    skills: str = Field(default="General Assistance", max_length=500)
    current_zone: str = Field(default="Sitabuldi", max_length=100)
    notes: str = Field(default="", max_length=500)
    volunteer_id: str | None = Field(default=None, max_length=50)


class VolunteerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    contact: str | None = Field(default=None, max_length=50)
    team_id: str | None = Field(default=None, max_length=50)
    skills: str | None = Field(default=None, max_length=500)
    availability_status: AvailabilityStatus | None = None
    current_zone: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)


class TaskAssignmentCreate(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    assignee_type: AssigneeType
    assignee_id: str = Field(min_length=1, max_length=100)
    task_type: str = Field(default="Delivery", max_length=100)
    task_description: str = Field(min_length=3, max_length=1000)
    priority: TaskPriority = Field(default=TaskPriority.HIGH)
    destination: str = Field(min_length=2, max_length=250)
    allocation_id: str | None = Field(default=None, max_length=100)
    assigned_by: str = Field(default="Coordinator", max_length=100)
    emergency_override: bool = Field(default=False)
    override_reason: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=500)


class TaskAssignmentAction(BaseModel):
    action: str = Field(min_length=2, max_length=50)
    actor: str = Field(default="Coordinator", max_length=100)
    note: str = Field(default="", max_length=500)
    reason: str = Field(default="", max_length=500)


# ---------------------------------------------------------------------------
# Phase 4: Relief Intelligence Models
# ---------------------------------------------------------------------------

class PriorityOverrideIn(BaseModel):
    overridden_band: str = Field(min_length=2, max_length=20)
    reason: str = Field(min_length=3, max_length=500)
    changed_by: str = Field(default="Coordinator", max_length=100)


def connection():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def initialise_database():
    with closing(connection()) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY,
                device_id TEXT NOT NULL,
                zone_id TEXT NOT NULL,
                water_level_cm REAL NOT NULL,
                rainfall_24h_mm REAL NOT NULL,
                local_status TEXT NOT NULL DEFAULT '',
                observed_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS readings_zone_time ON readings(zone_id, observed_at DESC);
            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY,
                reading_id INTEGER NOT NULL UNIQUE REFERENCES readings(id),
                zone_id TEXT NOT NULL,
                water_trend_cm_per_hour REAL NOT NULL,
                geo_risk_score INTEGER NOT NULL,
                flood_probability REAL NOT NULL,
                risk_level TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS predictions_zone_time ON predictions(zone_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS emergency_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL UNIQUE,
                event_id TEXT UNIQUE,
                household_label TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                quantity TEXT NOT NULL DEFAULT '',
                latitude REAL,
                longitude REAL,
                zone_id TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'MEDIUM',
                priority_score INTEGER NOT NULL DEFAULT 50,
                source TEXT NOT NULL DEFAULT 'web_form',
                verification_status TEXT NOT NULL DEFAULT 'Pending Verification',
                status TEXT NOT NULL DEFAULT 'Pending Verification',
                rejection_reason TEXT NOT NULL DEFAULT '',
                coordinator_notes TEXT NOT NULL DEFAULT '',
                is_possible_duplicate INTEGER NOT NULL DEFAULT 0,
                duplicate_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_requests_status ON emergency_requests(status);
            CREATE INDEX IF NOT EXISTS idx_requests_verification ON emergency_requests(verification_status);
            CREATE INDEX IF NOT EXISTS idx_requests_zone ON emergency_requests(zone_id);
            CREATE INDEX IF NOT EXISTS idx_requests_created ON emergency_requests(created_at DESC);

            CREATE TABLE IF NOT EXISTS request_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL,
                action TEXT NOT NULL,
                previous_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                changed_by TEXT NOT NULL DEFAULT 'Operator',
                reason TEXT NOT NULL DEFAULT '',
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_req_history ON request_history(request_id, timestamp ASC);

            CREATE TABLE IF NOT EXISTS sos_events (
                event_id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                unit TEXT NOT NULL,
                storage_location TEXT NOT NULL,
                on_hand REAL NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
                reserved REAL NOT NULL DEFAULT 0 CHECK(reserved >= 0),
                low_stock_threshold REAL NOT NULL DEFAULT 10 CHECK(low_stock_threshold >= 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_inv_category ON inventory_items(category);
            CREATE INDEX IF NOT EXISTS idx_inv_location ON inventory_items(storage_location);

            CREATE TABLE IF NOT EXISTS allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                allocation_id TEXT UNIQUE NOT NULL,
                request_id TEXT NOT NULL REFERENCES emergency_requests(request_id),
                inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
                quantity_reserved REAL NOT NULL CHECK(quantity_reserved >= 0),
                quantity_dispatched REAL NOT NULL DEFAULT 0 CHECK(quantity_dispatched >= 0),
                quantity_delivered REAL NOT NULL DEFAULT 0 CHECK(quantity_delivered >= 0),
                status TEXT NOT NULL DEFAULT 'Reserved' CHECK(status IN ('Reserved', 'Dispatched', 'Delivered', 'Cancelled')),
                allocated_by TEXT NOT NULL DEFAULT 'Coordinator',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_alloc_req ON allocations(request_id);
            CREATE INDEX IF NOT EXISTS idx_alloc_item ON allocations(inventory_item_id);
            CREATE INDEX IF NOT EXISTS idx_alloc_status ON allocations(status);

            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                movement_id TEXT UNIQUE NOT NULL,
                inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
                movement_type TEXT NOT NULL,
                quantity REAL NOT NULL,
                reference_id TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                operator TEXT NOT NULL DEFAULT 'System',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mov_item ON stock_movements(inventory_item_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_mov_ref ON stock_movements(reference_id);

            CREATE TABLE IF NOT EXISTS response_teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                team_type TEXT NOT NULL DEFAULT 'Rescue & Evacuation',
                skills TEXT NOT NULL DEFAULT '',
                equipment TEXT NOT NULL DEFAULT '',
                availability_status TEXT NOT NULL DEFAULT 'Available' CHECK(availability_status IN ('Available', 'Assigned', 'Busy', 'Offline')),
                base_location TEXT NOT NULL DEFAULT 'Central Depot - Sitabuldi',
                last_known_location TEXT NOT NULL DEFAULT 'Sitabuldi Base (Synthetic Demo)',
                leader_name TEXT NOT NULL DEFAULT '',
                contact_number TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_team_status ON response_teams(availability_status);

            CREATE TABLE IF NOT EXISTS volunteers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                volunteer_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                contact TEXT NOT NULL DEFAULT '',
                team_id TEXT DEFAULT NULL REFERENCES response_teams(team_id),
                skills TEXT NOT NULL DEFAULT 'General Assistance',
                availability_status TEXT NOT NULL DEFAULT 'Available' CHECK(availability_status IN ('Available', 'Assigned', 'Busy', 'Offline')),
                current_zone TEXT NOT NULL DEFAULT 'Sitabuldi',
                last_known_location TEXT NOT NULL DEFAULT 'Sitabuldi (Synthetic Demo)',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_vol_team ON volunteers(team_id);
            CREATE INDEX IF NOT EXISTS idx_vol_status ON volunteers(availability_status);

            CREATE TABLE IF NOT EXISTS task_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id TEXT UNIQUE NOT NULL,
                request_id TEXT NOT NULL REFERENCES emergency_requests(request_id),
                assignee_type TEXT NOT NULL CHECK(assignee_type IN ('Team', 'Volunteer')),
                assignee_id TEXT NOT NULL,
                assignee_name TEXT NOT NULL,
                task_type TEXT NOT NULL DEFAULT 'Delivery',
                task_description TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'High' CHECK(priority IN ('Critical', 'High', 'Medium', 'Low')),
                destination TEXT NOT NULL,
                allocation_id TEXT DEFAULT NULL,
                status TEXT NOT NULL DEFAULT 'Assigned' CHECK(status IN ('Pending Assignment', 'Assigned', 'Accepted', 'En Route', 'Arrived', 'Completed', 'Cancelled')),
                assigned_by TEXT NOT NULL DEFAULT 'Coordinator',
                notes TEXT NOT NULL DEFAULT '',
                override_reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_task_req ON task_assignments(request_id);
            CREATE INDEX IF NOT EXISTS idx_task_assignee ON task_assignments(assignee_id);
            CREATE INDEX IF NOT EXISTS idx_task_status ON task_assignments(status);
            CREATE INDEX IF NOT EXISTS idx_task_alloc ON task_assignments(allocation_id);

            CREATE TABLE IF NOT EXISTS assignment_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                assignment_id TEXT NOT NULL REFERENCES task_assignments(assignment_id),
                action TEXT NOT NULL,
                previous_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                actor TEXT NOT NULL DEFAULT 'Coordinator',
                note TEXT NOT NULL DEFAULT '',
                simulated_coordinates TEXT NOT NULL DEFAULT '',
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asnev_task ON assignment_events(assignment_id, timestamp ASC);

            CREATE TABLE IF NOT EXISTS priority_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL REFERENCES emergency_requests(request_id),
                original_score REAL NOT NULL,
                original_band TEXT NOT NULL,
                overridden_band TEXT NOT NULL,
                reason TEXT NOT NULL,
                changed_by TEXT NOT NULL DEFAULT 'Coordinator',
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_prio_req ON priority_overrides(request_id, timestamp DESC);
            """
        )
        # Migrate pre-existing databases: add local_status if missing
        columns = [row["name"] for row in db.execute("PRAGMA table_info(readings)")]
        if "local_status" not in columns:
            db.execute("ALTER TABLE readings ADD COLUMN local_status TEXT NOT NULL DEFAULT ''")
        
        # Seed initial synthetic demo requests if empty
        req_count = db.execute("SELECT COUNT(*) AS c FROM emergency_requests").fetchone()["c"]
        if req_count == 0:
            _seed_demo_requests(db)

        # Seed initial synthetic demo inventory if empty
        inv_count = db.execute("SELECT COUNT(*) AS c FROM inventory_items").fetchone()["c"]
        if inv_count == 0:
            _seed_demo_inventory(db)

        # Seed initial synthetic demo response teams and volunteers if empty
        team_count = db.execute("SELECT COUNT(*) AS c FROM response_teams").fetchone()["c"]
        if team_count == 0:
            _seed_demo_teams_and_volunteers(db)

        # Seed initial synthetic demo intelligence records if empty
        prio_count = db.execute("SELECT COUNT(*) AS c FROM priority_overrides").fetchone()["c"]
        if prio_count == 0:
            _seed_demo_intelligence(db)

        db.commit()


@app.on_event("startup")
def startup():
    initialise_database()
    load_zone_risks()


def load_zone_risks() -> dict[str, dict[str, str | int]]:
    if not GEO_RISK_CSV.is_file():
        raise RuntimeError(f"FloodGuard risk features not found: {GEO_RISK_CSV}")
    with GEO_RISK_CSV.open(newline="") as file:
        risks = {
            row["zone_id"]: {
                "geo_risk_score": int(row["risk_score"]),
                "geo_risk_class": row["risk_class"],
            }
            for row in csv.DictReader(file)
        }
    if not risks:
        raise RuntimeError(f"FloodGuard risk features contain no zones: {GEO_RISK_CSV}")
    return risks


ZONE_RISKS = load_zone_risks()


def load_rainfall_history() -> dict[str, float]:
    if not RAINFALL_CSV.is_file():
        return {}
    with RAINFALL_CSV.open(newline="") as file:
        return {row["date"]: float(row["rainfall_mm"]) for row in csv.DictReader(file)}


RAINFALL_HISTORY = load_rainfall_history()


def zone_risk(zone_id: str) -> int:
    try:
        return int(ZONE_RISKS[zone_id]["geo_risk_score"])
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Unknown zone_id: {zone_id}") from error


_LEVEL_SEVERITY = {"SAFE": 0, "WARNING": 1, "DANGER": 2, "CRITICAL": 3}


def risk_level(probability: float, water_fraction: float | None = None) -> str:
    if probability >= 0.75:
        level = "CRITICAL"
    elif probability >= 0.50:
        level = "DANGER"
    elif probability >= 0.25:
        level = "WARNING"
    else:
        level = "SAFE"
    if water_fraction is not None:
        for threshold, band in WATER_ALARM_BANDS:
            if water_fraction >= threshold and _LEVEL_SEVERITY[band] > _LEVEL_SEVERITY[level]:
                level = band
                break
    return level


def calculate_probability(water_level_cm: float, trend: float, rainfall_24h_mm: float, geo_score: int) -> float:
    # ponytail: transparent provisional calibration; replace with an event-validated model when flood labels exist.
    value = 0.35 * min(water_level_cm / SENSOR_RANGE_CM, 1) + 0.25 * min(max(trend, 0) / 20, 1)
    value += 0.20 * min(rainfall_24h_mm / 100, 1) + 0.20 * (geo_score / 100)
    return round(min(value, 1), 3)


def _trailing_24h_rainfall(observed_at: datetime) -> float:
    # ponytail: history is daily, so 24 h is today + yesterday; an hourly source is the upgrade path.
    return round(sum(RAINFALL_HISTORY.get((observed_at - timedelta(days=ago)).date().isoformat(), 0.0) for ago in (0, 1)), 2)


def _trend_cm_per_hour(points):
    # Median over consecutive rates so one ultrasonic echo spike cannot move the trend.
    rates = [(y2 - y1) / (x2 - x1) for (x1, y1), (x2, y2) in zip(points, points[1:]) if x2 > x1]
    return round(median(rates), 2) if rates else 0.0


def prediction_response(row: sqlite3.Row) -> dict:
    return dict(row)


# ---------------------------------------------------------------------------
# Map data: Nagpur zone polygons (with elevation), district boundary, hotspots
# ---------------------------------------------------------------------------

_MAP_ZONES_CANDIDATES = [
    ROOT / "viksit/nagpur_floodguard_deliverables (3)/risk_scores.geojson",
    ROOT / "viksit/NEW_floodguard_real_evidence_package/risk_scores.geojson",
]
# City boundary first: zones are clipped into the Nagpur city shape.
_MAP_BOUNDARY_CANDIDATES = [
    ROOT / "viksit/NEW_floodguard_real_evidence_package/nagpur_city_boundary.geojson",
    ROOT / "viksit/NEW_floodguard_real_evidence_package/nagpur_boundary.geojson",
    ROOT / "viksit/nagpur_floodguard_deliverables (3)/nagpur_boundary.geojson",
]
_MAP_HOTSPOTS_CANDIDATES = [
    ROOT / "viksit/NEW_floodguard_real_evidence_package/flood_hotspots.geojson",
]
_MAP_WATERWAYS_CANDIDATES = [
    ROOT / "viksit/NEW_floodguard_real_evidence_package/waterways.geojson",
]

_map_cache: dict | None = None
# Inset degree to provide clean breathing room between adjacent risk blocks
_MAP_CELL_INSET_DEG = 0.00035


def _first_existing(paths: list[Path]) -> Path | None:
    return next((p for p in paths if p.is_file()), None)


def _trim_feature(feature: dict, keys: list[str]) -> dict:
    props = feature.get("properties", {}) or {}
    return {
        "type": "Feature",
        "properties": {k: props.get(k) for k in keys},
        "geometry": feature.get("geometry"),
    }


def _clip_zones_to_city(zones: list[dict], city_geometry: dict) -> list[dict]:
    """Cleanly clip zone cells to city boundary without overlapping or displaced blocks."""
    try:
        from shapely.geometry import shape, mapping
    except ImportError:
        return zones

    city_shape = shape(city_geometry)
    clipped: list[dict] = []
    for feature in zones:
        zone_shape = shape(feature["geometry"])
        result = zone_shape.intersection(city_shape)
        if result.is_empty:
            continue
        if result.geom_type == "MultiPolygon":
            result = max(result.geoms, key=lambda p: p.area)
        if result.geom_type != "Polygon" or result.area < 1e-6:
            continue
        # Clean inset so blocks stay clearly separated and not an overwhelming solid slab
        inset = result.buffer(-_MAP_CELL_INSET_DEG)
        if not inset.is_empty and inset.geom_type == "Polygon" and inset.area > 1e-6:
            result = inset
        clipped.append({**feature, "geometry": mapping(result)})
    return clipped


def load_map_data() -> dict:
    data: dict = {"zones": None, "boundary": None, "hotspots": None, "waterways": None}

    zones_path = _first_existing(_MAP_ZONES_CANDIDATES)
    if zones_path is not None:
        gj = json.loads(zones_path.read_text())
        data["zones"] = {
            "type": "FeatureCollection",
            "features": [
                _trim_feature(f, ["zone_id", "risk_score", "risk_class", "elevation_m"])
                for f in gj.get("features", [])
            ],
        }

    boundary_path = _first_existing(_MAP_BOUNDARY_CANDIDATES)
    if boundary_path is not None:
        gj = json.loads(boundary_path.read_text())
        features = gj.get("features", [])
        if features:
            data["boundary"] = {
                "type": "Feature",
                "properties": {"name": (features[0].get("properties") or {}).get("name", "Nagpur")},
                "geometry": features[0].get("geometry"),
            }
            # Carve the zone grid into the genuine Nagpur city boundary
            if data["zones"] is not None:
                data["zones"]["features"] = _clip_zones_to_city(data["zones"]["features"], features[0]["geometry"])

    hotspots_path = _first_existing(_MAP_HOTSPOTS_CANDIDATES)
    if hotspots_path is not None:
        gj = json.loads(hotspots_path.read_text())
        data["hotspots"] = {
            "type": "FeatureCollection",
            "features": [
                _trim_feature(f, ["name", "event_year", "evidence"])
                for f in gj.get("features", [])
            ],
        }

    waterways_path = _first_existing(_MAP_WATERWAYS_CANDIDATES)
    if waterways_path is not None:
        try:
            gj = json.loads(waterways_path.read_text())
            water_features = []
            for f in gj.get("features", []):
                name = (f.get("properties") or {}).get("name")
                if not name:
                    continue
                geom = f.get("geometry") or {}
                # Keep named lakes and rivers within Nagpur bounds
                if geom.get("type") in ("Polygon", "MultiPolygon", "LineString"):
                    coords = geom.get("coordinates", [])
                    # Quick bounding check
                    sample = coords[0][0] if geom.get("type") == "Polygon" and coords and coords[0] else (coords[0] if geom.get("type") == "LineString" and coords else None)
                    if sample and isinstance(sample, (list, tuple)) and len(sample) >= 2:
                        lon, lat = sample[0], sample[1]
                        if 78.95 <= lon <= 79.22 and 21.02 <= lat <= 21.26:
                            water_features.append({
                                "type": "Feature",
                                "properties": {"name": name, "natural": (f.get("properties") or {}).get("natural", "water")},
                                "geometry": geom,
                            })
            if water_features:
                data["waterways"] = {"type": "FeatureCollection", "features": water_features[:40]}
        except Exception:
            pass

    return data


@app.get("/api/map")
def map_data():
    global _map_cache
    if _map_cache is None:
        _map_cache = load_map_data()
    if not _map_cache["zones"]:
        raise HTTPException(status_code=404, detail="Map zone polygons not found on server")
    return _map_cache


@app.get("/health")
def health():
    return {"status": "ok", "zones_loaded": len(ZONE_RISKS)}


@app.get("/api/zones")
def zones():
    return [{"zone_id": zone_id, **risk} for zone_id, risk in ZONE_RISKS.items()]


@app.post("/api/readings", status_code=status.HTTP_201_CREATED)
def ingest_reading(reading: ReadingIn, x_device_key: str | None = Header(default=None)):
    if DEVICE_API_KEY and x_device_key != DEVICE_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid device key")
    geo_score = zone_risk(reading.zone_id)
    observed_at_utc = (reading.timestamp or datetime.now(timezone.utc)).astimezone(timezone.utc)
    observed_at = observed_at_utc.isoformat()
    rainfall = reading.rainfall_24h_mm if reading.rainfall_24h_mm > 0 else _trailing_24h_rainfall(observed_at_utc)

    with closing(connection()) as db:
        cursor = db.execute(
            "INSERT INTO readings(device_id, zone_id, water_level_cm, rainfall_24h_mm, local_status, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
            (reading.device_id, reading.zone_id, reading.water_level_cm, rainfall, reading.local_status or "", observed_at),
        )
        rows = list(reversed(db.execute(
            "SELECT water_level_cm, observed_at FROM readings WHERE zone_id = ? ORDER BY observed_at DESC LIMIT 10",
            (reading.zone_id,),
        ).fetchall()))
        oldest = datetime.fromisoformat(rows[0]["observed_at"])
        points = [
            ((datetime.fromisoformat(row["observed_at"]) - oldest).total_seconds() / 3600, row["water_level_cm"])
            for row in rows
        ]
        trend = _trend_cm_per_hour(points)
        probability = calculate_probability(reading.water_level_cm, trend, rainfall, geo_score)
        created_at = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT INTO predictions(reading_id, zone_id, water_trend_cm_per_hour, geo_risk_score, flood_probability, risk_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cursor.lastrowid, reading.zone_id, trend, geo_score, probability, risk_level(probability, min(reading.water_level_cm / SENSOR_RANGE_CM, 1)), created_at),
        )
        db.commit()
        row = db.execute(
            """SELECT r.device_id, r.zone_id, r.water_level_cm, r.rainfall_24h_mm, r.local_status, r.observed_at,
                      p.water_trend_cm_per_hour, p.geo_risk_score, p.flood_probability, p.risk_level
               FROM predictions p JOIN readings r ON r.id = p.reading_id WHERE p.reading_id = ?""",
            (cursor.lastrowid,),
        ).fetchone()
    return prediction_response(row)


@app.get("/api/zones/{zone_id}/latest")
def latest_prediction(zone_id: str):
    zone_risk(zone_id)
    with closing(connection()) as db:
        row = db.execute(
            """SELECT r.device_id, r.zone_id, r.water_level_cm, r.rainfall_24h_mm, r.local_status, r.observed_at,
                      p.water_trend_cm_per_hour, p.geo_risk_score, p.flood_probability, p.risk_level
               FROM predictions p JOIN readings r ON r.id = p.reading_id
               WHERE p.zone_id = ? ORDER BY p.created_at DESC LIMIT 1""",
            (zone_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"No readings for zone_id: {zone_id}")
    return prediction_response(row)


@app.get("/api/zones/{zone_id}/history")
def prediction_history(zone_id: str, limit: int = Query(default=50, ge=1, le=500)):
    zone_risk(zone_id)
    with closing(connection()) as db:
        rows = db.execute(
            """SELECT r.device_id, r.zone_id, r.water_level_cm, r.rainfall_24h_mm, r.local_status, r.observed_at,
                      p.water_trend_cm_per_hour, p.geo_risk_score, p.flood_probability, p.risk_level
               FROM predictions p JOIN readings r ON r.id = p.reading_id
               WHERE p.zone_id = ? ORDER BY p.created_at DESC LIMIT ?""",
            (zone_id, limit),
        ).fetchall()
    return [prediction_response(row) for row in rows]


# ---------------------------------------------------------------------------
# Emergency Requests and SOS Module
# ---------------------------------------------------------------------------

def compute_priority_score(category: str, severity: str, zone_id: str) -> int:
    severity_weights = {"CRITICAL": 40, "HIGH": 30, "MEDIUM": 20, "LOW": 10}
    category_weights = {
        "Rescue": 30,
        "Medical": 25,
        "Water": 20,
        "Food": 15,
        "Shelter": 15,
    }
    sev_score = severity_weights.get(severity.upper(), 20)
    cat_score = category_weights.get(category, 15)

    geo_bonus = 0
    if zone_id in ZONE_RISKS:
        geo_score = int(ZONE_RISKS[zone_id].get("geo_risk_score", 0))
        geo_bonus = int(min(geo_score, 100) * 0.3)

    return max(1, min(100, sev_score + cat_score + geo_bonus))


def generate_request_id() -> str:
    now_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    short_suffix = uuid.uuid4().hex[:6].upper()
    return f"REQ-{now_str}-{short_suffix}"


def check_possible_duplicate(db: sqlite3.Connection, household_label: str, zone_id: str, category: str) -> tuple[bool, str]:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    rows = db.execute(
        """SELECT request_id, household_label, category, zone_id, created_at 
           FROM emergency_requests 
           WHERE created_at >= ? 
             AND status NOT IN ('Fulfilled', 'Rejected')
             AND (LOWER(household_label) = LOWER(?) OR (zone_id = ? AND category = ?))
           ORDER BY created_at DESC LIMIT 1""",
        (cutoff, household_label.strip(), zone_id, category),
    ).fetchall()
    if rows:
        match = rows[0]
        if match["household_label"].strip().lower() == household_label.strip().lower():
            reason = f"Active request {match['request_id']} already exists for {match['household_label']}"
        else:
            reason = f"Active {match['category']} request {match['request_id']} already exists in zone {zone_id}"
        return True, reason
    return False, ""


def get_zone_context(db: sqlite3.Connection, zone_id: str) -> dict | None:
    row = db.execute(
        """SELECT r.device_id, r.zone_id, r.water_level_cm, r.rainfall_24h_mm, r.local_status, r.observed_at,
                  p.water_trend_cm_per_hour, p.geo_risk_score, p.flood_probability, p.risk_level
           FROM predictions p JOIN readings r ON r.id = p.reading_id
           WHERE p.zone_id = ? ORDER BY p.created_at DESC LIMIT 1""",
        (zone_id,),
    ).fetchone()
    if row:
        return dict(row)
    if zone_id in ZONE_RISKS:
        return {
            "zone_id": zone_id,
            "geo_risk_score": ZONE_RISKS[zone_id]["geo_risk_score"],
            "geo_risk_class": ZONE_RISKS[zone_id]["geo_risk_class"],
            "water_level_cm": None,
            "risk_level": "UNKNOWN",
        }
    return None


def _seed_demo_requests(db: sqlite3.Connection):
    now = datetime.now(timezone.utc)
    demo_records = [
        {
            "request_id": "REQ-DEMO-001",
            "event_id": "SOS-DEMO-EVT-001",
            "household_label": "Demo Household #101 - Sitabuldi",
            "category": "Rescue",
            "description": "[DEMO] Ground floor inundated (approx 45cm). 4 family members including an elderly person need evacuation.",
            "quantity": "4 persons",
            "latitude": 21.1458,
            "longitude": 79.0882,
            "zone_id": "Z001",
            "severity": "CRITICAL",
            "priority_score": 95,
            "source": "simulated_sos",
            "verification_status": "Verified",
            "status": "Assigned",
            "rejection_reason": "",
            "coordinator_notes": "Dispatched SDRF Boat Unit 2. Target ETA 15 mins.",
            "is_possible_duplicate": 0,
            "duplicate_notes": "",
            "created_at": (now - timedelta(minutes=45)).isoformat(),
            "updated_at": (now - timedelta(minutes=10)).isoformat(),
            "history": [
                ("CREATED", "", "Pending Verification", "System", "Simulated SOS distress event logged", (now - timedelta(minutes=45)).isoformat()),
                ("VERIFIED", "Pending Verification", "Verified", "Coordinator Sharma", "Confirmed via municipal ward helpline", (now - timedelta(minutes=30)).isoformat()),
                ("STATUS_UPDATE", "Verified", "Assigned", "Coordinator Sharma", "Dispatched SDRF Boat Unit 2", (now - timedelta(minutes=10)).isoformat()),
            ]
        },
        {
            "request_id": "REQ-DEMO-002",
            "event_id": None,
            "household_label": "Demo Household #102 - Reshimbagh",
            "category": "Water",
            "description": "[DEMO] Municipal water pipeline contaminated with storm run-off silt. Drinking water cans needed.",
            "quantity": "5 cans (100L)",
            "latitude": 21.1272,
            "longitude": 79.1038,
            "zone_id": "Z002",
            "severity": "HIGH",
            "priority_score": 75,
            "source": "web_form",
            "verification_status": "Verified",
            "status": "In Progress",
            "rejection_reason": "",
            "coordinator_notes": "Relief tanker #4 en route to Reshimbagh chowk.",
            "is_possible_duplicate": 0,
            "duplicate_notes": "",
            "created_at": (now - timedelta(hours=2)).isoformat(),
            "updated_at": (now - timedelta(minutes=25)).isoformat(),
            "history": [
                ("CREATED", "", "Pending Verification", "Citizen (Web Form)", "Manual request intake via portal", (now - timedelta(hours=2)).isoformat()),
                ("VERIFIED", "Pending Verification", "Verified", "Operator Patel", "Verified water supply outage with Jal Nigam", (now - timedelta(hours=1, minutes=15)).isoformat()),
                ("STATUS_UPDATE", "Verified", "In Progress", "Coordinator Sharma", "Relief tanker dispatched", (now - timedelta(minutes=25)).isoformat()),
            ]
        },
        {
            "request_id": "REQ-DEMO-003",
            "event_id": None,
            "household_label": "Demo Household #103 - Dharampeth",
            "category": "Medical",
            "description": "[DEMO] Power cut caused domestic refrigerator failure; urgent insulin cold storage supplies required.",
            "quantity": "Insulin & Ice Pack",
            "latitude": 21.1410,
            "longitude": 79.0620,
            "zone_id": "Z003",
            "severity": "MEDIUM",
            "priority_score": 62,
            "source": "web_form",
            "verification_status": "Pending Verification",
            "status": "Pending Verification",
            "rejection_reason": "",
            "coordinator_notes": "Awaiting secondary phone check by relief desk.",
            "is_possible_duplicate": 0,
            "duplicate_notes": "",
            "created_at": (now - timedelta(minutes=20)).isoformat(),
            "updated_at": (now - timedelta(minutes=20)).isoformat(),
            "history": [
                ("CREATED", "", "Pending Verification", "Citizen (Web Form)", "Manual request intake via portal", (now - timedelta(minutes=20)).isoformat()),
            ]
        },
        {
            "request_id": "REQ-DEMO-004",
            "event_id": "SOS-DEMO-EVT-004",
            "household_label": "Demo Household #104 - Gandhibagh",
            "category": "Food",
            "description": "[DEMO] Ready-to-eat dry ration food packets needed for 6 stranded residents on terrace.",
            "quantity": "6 ration packets",
            "latitude": 21.1520,
            "longitude": 79.1120,
            "zone_id": "Z001",
            "severity": "HIGH",
            "priority_score": 70,
            "source": "simulated_sos",
            "verification_status": "Pending Verification",
            "status": "Pending Verification",
            "rejection_reason": "",
            "coordinator_notes": "Simulated SOS distress event logged.",
            "is_possible_duplicate": 0,
            "duplicate_notes": "",
            "created_at": (now - timedelta(minutes=5)).isoformat(),
            "updated_at": (now - timedelta(minutes=5)).isoformat(),
            "history": [
                ("CREATED", "", "Pending Verification", "System", "Simulated SOS distress event logged", (now - timedelta(minutes=5)).isoformat()),
            ]
        }
    ]
    for rec in demo_records:
        if rec["event_id"]:
            db.execute("INSERT OR IGNORE INTO sos_events (event_id, request_id, created_at) VALUES (?, ?, ?)",
                       (rec["event_id"], rec["request_id"], rec["created_at"]))
        db.execute(
            """INSERT OR IGNORE INTO emergency_requests 
               (request_id, event_id, household_label, category, description, quantity, latitude, longitude,
                zone_id, severity, priority_score, source, verification_status, status, rejection_reason,
                coordinator_notes, is_possible_duplicate, duplicate_notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rec["request_id"], rec["event_id"], rec["household_label"], rec["category"], rec["description"],
             rec["quantity"], rec["latitude"], rec["longitude"], rec["zone_id"], rec["severity"],
             rec["priority_score"], rec["source"], rec["verification_status"], rec["status"],
             rec["rejection_reason"], rec["coordinator_notes"], rec["is_possible_duplicate"],
             rec["duplicate_notes"], rec["created_at"], rec["updated_at"])
        )
        for h in rec["history"]:
            db.execute(
                """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (rec["request_id"], h[0], h[1], h[2], h[3], h[4], h[5])
            )


@app.post("/api/requests", status_code=status.HTTP_201_CREATED)
def create_request(payload: EmergencyRequestCreate):
    if payload.zone_id not in ZONE_RISKS:
        raise HTTPException(status_code=400, detail=f"Invalid zone_id: {payload.zone_id}")

    priority = compute_priority_score(payload.category.value, payload.severity.value, payload.zone_id)
    req_id = generate_request_id()
    now = datetime.now(timezone.utc).isoformat()

    with closing(connection()) as db:
        is_dup, dup_reason = check_possible_duplicate(db, payload.household_label, payload.zone_id, payload.category.value)
        db.execute(
            """INSERT INTO emergency_requests 
               (request_id, event_id, household_label, category, description, quantity, latitude, longitude,
                zone_id, severity, priority_score, source, verification_status, status, rejection_reason,
                coordinator_notes, is_possible_duplicate, duplicate_notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (req_id, None, payload.household_label.strip(), payload.category.value, payload.description.strip(),
             payload.quantity or "", payload.latitude, payload.longitude, payload.zone_id,
             payload.severity.value, priority, payload.source or "web_form", "Pending Verification",
             "Pending Verification", "", payload.coordinator_notes or "", 1 if is_dup else 0,
             dup_reason, now, now),
        )
        history_reason = f"Request submitted via {payload.source or 'Web Form'}"
        if is_dup:
            history_reason += f" - [Flagged possible duplicate: {dup_reason}]"
        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (req_id, "CREATED", "", "Pending Verification", "System / Citizen", history_reason, now),
        )
        db.commit()

        req_row = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (req_id,)).fetchone()
        history_rows = db.execute("SELECT * FROM request_history WHERE request_id = ? ORDER BY timestamp ASC", (req_id,)).fetchall()
        zone_ctx = get_zone_context(db, payload.zone_id)

    return {
        "request": dict(req_row),
        "history": [dict(h) for h in history_rows],
        "zone_context": zone_ctx,
    }


@app.get("/api/requests")
def list_requests(
    status: Optional[str] = None,
    verification_status: Optional[str] = None,
    severity: Optional[str] = None,
    category: Optional[str] = None,
    zone_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    with closing(connection()) as db:
        conditions = []
        params = []
        if status:
            conditions.append("status = ?")
            params.append(status)
        if verification_status:
            conditions.append("verification_status = ?")
            params.append(verification_status)
        if severity:
            conditions.append("severity = ?")
            params.append(severity.upper())
        if category:
            conditions.append("category = ?")
            params.append(category)
        if zone_id:
            conditions.append("zone_id = ?")
            params.append(zone_id)
        if search:
            conditions.append("(request_id LIKE ? OR household_label LIKE ? OR description LIKE ?)")
            search_param = f"%{search.strip()}%"
            params.extend([search_param, search_param, search_param])

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        total = db.execute(f"SELECT COUNT(*) AS c FROM emergency_requests {where_clause}", params).fetchone()["c"]

        query_sql = f"""SELECT * FROM emergency_requests {where_clause} 
                        ORDER BY priority_score DESC, created_at DESC 
                        LIMIT ? OFFSET ?"""
        rows = db.execute(query_sql, params + [limit, offset]).fetchall()

        counts_raw = db.execute(
            """SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'Pending Verification' THEN 1 ELSE 0 END) AS pending_verification,
                SUM(CASE WHEN verification_status = 'Verified' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'Assigned' THEN 1 ELSE 0 END) AS assigned,
                SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN status = 'Fulfilled' THEN 1 ELSE 0 END) AS fulfilled,
                SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN is_possible_duplicate = 1 THEN 1 ELSE 0 END) AS duplicates
               FROM emergency_requests"""
        ).fetchone()

    return {
        "total": total,
        "items": [dict(r) for r in rows],
        "counts": {
            "total": counts_raw["total"] or 0,
            "pending_verification": counts_raw["pending_verification"] or 0,
            "verified": counts_raw["verified"] or 0,
            "assigned": counts_raw["assigned"] or 0,
            "in_progress": counts_raw["in_progress"] or 0,
            "fulfilled": counts_raw["fulfilled"] or 0,
            "rejected": counts_raw["rejected"] or 0,
            "critical": counts_raw["critical"] or 0,
            "high": counts_raw["high"] or 0,
            "duplicates": counts_raw["duplicates"] or 0,
        }
    }


@app.get("/api/requests/{request_id}")
def get_request(request_id: str):
    with closing(connection()) as db:
        req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail=f"Request not found: {request_id}")
        history = db.execute("SELECT * FROM request_history WHERE request_id = ? ORDER BY timestamp ASC", (request_id,)).fetchall()
        zone_ctx = get_zone_context(db, req["zone_id"])
        allocations = db.execute(
            """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
               FROM allocations a
               JOIN inventory_items i ON i.id = a.inventory_item_id
               WHERE a.request_id = ?
               ORDER BY a.created_at DESC""",
            (request_id,)
        ).fetchall()

        task_rows = db.execute(
            """SELECT t.*
               FROM task_assignments t
               WHERE t.request_id = ?
               ORDER BY t.created_at DESC""",
            (request_id,)
        ).fetchall()
        assignments = []
        for t in task_rows:
            t_dict = dict(t)
            ev_rows = db.execute(
                "SELECT * FROM assignment_events WHERE assignment_id = ? ORDER BY timestamp ASC",
                (t["assignment_id"],)
            ).fetchall()
            t_dict["events"] = [dict(e) for e in ev_rows]
            assignments.append(t_dict)

    return {
        "request": dict(req),
        "history": [dict(h) for h in history],
        "zone_context": zone_ctx,
        "allocations": [dict(a) for a in allocations],
        "assignments": assignments,
    }


@app.patch("/api/requests/{request_id}")
def update_request(request_id: str, payload: EmergencyRequestUpdate):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        current = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (request_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail=f"Request not found: {request_id}")

        cur_v_status = current["verification_status"]
        cur_status = current["status"]
        cur_notes = current["coordinator_notes"]
        cur_rej = current["rejection_reason"]
        cur_sev = current["severity"]

        new_v_status = payload.verification_status.value if payload.verification_status else cur_v_status
        new_status = payload.status.value if payload.status else cur_status
        new_notes = payload.coordinator_notes if payload.coordinator_notes is not None else cur_notes
        new_rej = payload.rejection_reason if payload.rejection_reason is not None else cur_rej
        new_sev = payload.severity.value if payload.severity else cur_sev

        # Validation rules
        if new_v_status == "Rejected" or new_status == "Rejected":
            new_v_status = "Rejected"
            new_status = "Rejected"
            if not new_rej or not new_rej.strip():
                raise HTTPException(status_code=400, detail="Rejection reason is required when rejecting a request")

        if payload.verification_status and payload.verification_status.value == "Verified":
            new_v_status = "Verified"
            new_rej = ""
            if cur_status in ("Pending Verification", "Rejected"):
                new_status = "Verified"

        if payload.status:
            if payload.status.value in ("Assigned", "In Progress", "Fulfilled"):
                if new_v_status == "Rejected":
                    raise HTTPException(status_code=400, detail="Cannot assign or progress a rejected request. Please verify it first.")
            if payload.status.value == "Fulfilled":
                new_v_status = "Verified"

        changed_action = "STATUS_UPDATE"
        if new_v_status != cur_v_status:
            changed_action = "VERIFIED" if new_v_status == "Verified" else "REJECTED"
        elif new_status != cur_status:
            changed_action = "STATUS_CHANGE"
        elif new_notes != cur_notes:
            changed_action = "NOTE_UPDATED"
        elif new_sev != cur_sev:
            changed_action = "SEVERITY_UPDATED"

        reason_text = payload.change_reason or payload.rejection_reason or ""
        if not reason_text:
            if changed_action == "VERIFIED":
                reason_text = "Request verified by coordinator"
            elif changed_action == "REJECTED":
                reason_text = new_rej
            elif changed_action == "STATUS_CHANGE":
                reason_text = f"Status advanced to {new_status}"
            else:
                reason_text = "Updated request details"

        priority = current["priority_score"]
        if new_sev != cur_sev:
            priority = compute_priority_score(current["category"], new_sev, current["zone_id"])

        db.execute(
            """UPDATE emergency_requests 
               SET verification_status = ?, status = ?, rejection_reason = ?, coordinator_notes = ?,
                   severity = ?, priority_score = ?, updated_at = ?
               WHERE request_id = ?""",
            (new_v_status, new_status, new_rej, new_notes, new_sev, priority, now, request_id),
        )

        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (request_id, changed_action, cur_status, new_status, payload.changed_by or "Operator", reason_text, now),
        )
        db.commit()

        updated_req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (request_id,)).fetchone()
        history = db.execute("SELECT * FROM request_history WHERE request_id = ? ORDER BY timestamp ASC", (request_id,)).fetchall()
        zone_ctx = get_zone_context(db, updated_req["zone_id"])

    return {
        "request": dict(updated_req),
        "history": [dict(h) for h in history],
        "zone_context": zone_ctx,
    }


@app.post("/api/sos/simulate")
def simulate_sos(payload: SOSSimulateIn, response: Response):
    if payload.zone_id not in ZONE_RISKS:
        raise HTTPException(status_code=400, detail=f"Invalid zone_id: {payload.zone_id}")

    event_id = payload.event_id.strip() if payload.event_id and payload.event_id.strip() else f"SOS-EVT-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    with closing(connection()) as db:
        existing_event = db.execute("SELECT * FROM sos_events WHERE event_id = ?", (event_id,)).fetchone()
        if existing_event:
            req_id = existing_event["request_id"]
            req_row = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (req_id,)).fetchone()
            history_rows = db.execute("SELECT * FROM request_history WHERE request_id = ? ORDER BY timestamp ASC", (req_id,)).fetchall()
            zone_ctx = get_zone_context(db, req_row["zone_id"])
            response.status_code = status.HTTP_200_OK
            return {
                "event_id": event_id,
                "request_id": req_id,
                "request": dict(req_row),
                "history": [dict(h) for h in history_rows],
                "zone_context": zone_ctx,
                "acknowledged": True,
                "is_retry": True,
                "message": "Duplicate SOS event detected; existing request returned idempotently",
            }

        req_id = generate_request_id()
        priority = compute_priority_score(payload.category.value, payload.severity.value, payload.zone_id)
        is_dup, dup_reason = check_possible_duplicate(db, payload.household_label, payload.zone_id, payload.category.value)

        db.execute(
            "INSERT INTO sos_events (event_id, request_id, created_at) VALUES (?, ?, ?)",
            (event_id, req_id, now),
        )

        db.execute(
            """INSERT INTO emergency_requests 
               (request_id, event_id, household_label, category, description, quantity, latitude, longitude,
                zone_id, severity, priority_score, source, verification_status, status, rejection_reason,
                coordinator_notes, is_possible_duplicate, duplicate_notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (req_id, event_id, payload.household_label.strip(), payload.category.value,
             payload.description.strip(), payload.quantity or "", payload.latitude, payload.longitude,
             payload.zone_id, payload.severity.value, priority, "simulated_sos", "Pending Verification",
             "Pending Verification", "", payload.coordinator_notes or "Simulated SOS distress event logged",
             1 if is_dup else 0, dup_reason, now, now),
        )

        history_reason = f"Simulated SOS event received (Event ID: {event_id})"
        if is_dup:
            history_reason += f" - [Flagged possible duplicate: {dup_reason}]"

        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (req_id, "CREATED", "", "Pending Verification", "SOS Simulator", history_reason, now),
        )
        db.commit()

        req_row = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (req_id,)).fetchone()
        history_rows = db.execute("SELECT * FROM request_history WHERE request_id = ? ORDER BY timestamp ASC", (req_id,)).fetchall()
        zone_ctx = get_zone_context(db, payload.zone_id)

    response.status_code = status.HTTP_201_CREATED
    return {
        "event_id": event_id,
        "request_id": req_id,
        "request": dict(req_row),
        "history": [dict(h) for h in history_rows],
        "zone_context": zone_ctx,
        "acknowledged": True,
        "is_retry": False,
        "message": "Simulated SOS accepted and emergency request created",
    }


# ---------------------------------------------------------------------------
# Relief Inventory & Stock Allocation Module
# ---------------------------------------------------------------------------

def inventory_item_response(row: sqlite3.Row) -> dict:
    d = dict(row)
    on_hand = float(d.get("on_hand", 0.0))
    reserved = float(d.get("reserved", 0.0))
    available = max(0.0, on_hand - reserved)
    threshold = float(d.get("low_stock_threshold", 0.0))

    if available <= 0:
        stock_status = "Out of Stock"
    elif available <= threshold:
        stock_status = "Low Stock"
    else:
        stock_status = "Available"

    d["available"] = round(available, 2)
    d["stock_status"] = stock_status
    return d


def _seed_demo_inventory(db: sqlite3.Connection):
    now = datetime.now(timezone.utc).isoformat()
    demo_items = [
        ("INV-WTR-01", "Packaged Drinking Water (20L Can)", "Drinking Water", "cans", "Central Relief Depot - Sitabuldi", 150.0, 20.0, 30.0),
        ("INV-WTR-02", "Purified Water Bottles (1L Carton)", "Drinking Water", "bottles", "West Distribution Center - Dharampeth", 300.0, 0.0, 50.0),
        ("INV-FOD-01", "High-Calorie Ready-to-Eat Ration Packets", "Food", "packets", "Central Relief Depot - Sitabuldi", 500.0, 50.0, 100.0),
        ("INV-FOD-02", "Emergency Family Dry Grocery Ration Kit", "Food", "kits", "East Relief Post - Lakadganj", 80.0, 10.0, 25.0),
        ("INV-MED-01", "Disaster Trauma & First Aid Kit", "Medical Supplies", "kits", "Central Relief Depot - Sitabuldi", 65.0, 5.0, 20.0),
        ("INV-MED-02", "Medical Cold Storage Gel Pack (Insulin cooling)", "Medical Supplies", "kits", "West Distribution Center - Dharampeth", 40.0, 2.0, 15.0),
        ("INV-RSC-01", "Inflatable Rescue Life Jacket (Adult)", "Rescue Equipment", "pieces", "North Sector Warehouse - Kamptee Rd", 45.0, 8.0, 15.0),
        ("INV-RSC-02", "Heavy Duty Rescue Polypropylene Rope (50m)", "Rescue Equipment", "pieces", "North Sector Warehouse - Kamptee Rd", 25.0, 0.0, 10.0),
        ("INV-SHL-01", "Waterproof Heavy Duty Tarpaulin (18x12 ft)", "Shelter Supplies", "pieces", "East Relief Post - Lakadganj", 120.0, 15.0, 30.0),
        ("INV-SHL-02", "Fleece Thermal Emergency Blanket", "Shelter Supplies", "blankets", "Central Relief Depot - Sitabuldi", 250.0, 30.0, 50.0),
        ("INV-OTH-01", "Rechargeable Solar LED Emergency Lantern", "Other", "pieces", "West Distribution Center - Dharampeth", 60.0, 0.0, 20.0),
    ]
    for item in demo_items:
        db.execute(
            """INSERT OR IGNORE INTO inventory_items
               (item_code, name, category, unit, storage_location, on_hand, reserved, low_stock_threshold, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item[0], item[1], item[2], item[3], item[4], item[5], item[6], item[7], now, now)
        )
        row = db.execute("SELECT id FROM inventory_items WHERE item_code = ?", (item[0],)).fetchone()
        if row:
            db.execute(
                """INSERT OR IGNORE INTO stock_movements
                   (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
                   VALUES (?, ?, 'INITIAL_STOCK', ?, 'SEED_INITIAL', 'Initial baseline relief inventory stock', 'System', ?)""",
                (f"MOV-INIT-{item[0]}", row["id"], item[5], now)
            )

    req1 = db.execute("SELECT id FROM emergency_requests WHERE request_id = 'REQ-DEMO-001'").fetchone()
    item_rsc = db.execute("SELECT id FROM inventory_items WHERE item_code = 'INV-RSC-01'").fetchone()
    if req1 and item_rsc:
        db.execute(
            """INSERT OR IGNORE INTO allocations
               (allocation_id, request_id, inventory_item_id, quantity_reserved, quantity_dispatched, quantity_delivered, status, allocated_by, notes, created_at, updated_at)
               VALUES ('ALC-DEMO-001', 'REQ-DEMO-001', ?, 4.0, 4.0, 0.0, 'Dispatched', 'Coordinator Sharma', 'Dispatched with SDRF Boat Unit 2', ?, ?)""",
            (item_rsc["id"], now, now)
        )
        db.execute(
            """INSERT OR IGNORE INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES ('MOV-ALC-001', ?, 'DISPATCH', -4.0, 'ALC-DEMO-001', 'Dispatched for boat evacuation request REQ-DEMO-001', 'Coordinator Sharma', ?)""",
            (item_rsc["id"], now)
        )

    req2 = db.execute("SELECT id FROM emergency_requests WHERE request_id = 'REQ-DEMO-002'").fetchone()
    item_wtr = db.execute("SELECT id FROM inventory_items WHERE item_code = 'INV-WTR-01'").fetchone()
    if req2 and item_wtr:
        db.execute(
            """INSERT OR IGNORE INTO allocations
               (allocation_id, request_id, inventory_item_id, quantity_reserved, quantity_dispatched, quantity_delivered, status, allocated_by, notes, created_at, updated_at)
               VALUES ('ALC-DEMO-002', 'REQ-DEMO-002', ?, 5.0, 5.0, 0.0, 'Dispatched', 'Operator Patel', 'Loaded onto Relief Tanker Route #4', ?, ?)""",
            (item_wtr["id"], now, now)
        )
        db.execute(
            """INSERT OR IGNORE INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES ('MOV-ALC-002', ?, 'DISPATCH', -5.0, 'ALC-DEMO-002', 'Dispatched 5 water cans for REQ-DEMO-002', 'Operator Patel', ?)""",
            (item_wtr["id"], now)
        )


@app.get("/api/inventory")
def list_inventory(
    search: Optional[str] = None,
    category: Optional[str] = None,
    location: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    with closing(connection()) as db:
        conditions = []
        params = []

        if category:
            conditions.append("category = ?")
            params.append(category)
        if location:
            conditions.append("storage_location = ?")
            params.append(location)
        if search:
            conditions.append("(name LIKE ? OR item_code LIKE ? OR storage_location LIKE ?)")
            s = f"%{search.strip()}%"
            params.extend([s, s, s])

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        all_rows = db.execute(f"SELECT * FROM inventory_items {where_clause} ORDER BY category, name", params).fetchall()
        formatted_items = [inventory_item_response(r) for r in all_rows]

        # Apply status filter in memory if specified
        if status and status.upper() != "ALL":
            status_norm = status.lower().replace("_", " ")
            formatted_items = [i for i in formatted_items if i["stock_status"].lower() == status_norm]

        total = len(formatted_items)
        paginated_items = formatted_items[offset : offset + limit]

        # Aggregate summary statistics across all inventory items
        summary_raw = db.execute(
            """SELECT 
                COALESCE(SUM(on_hand), 0) AS total_on_hand,
                COALESCE(SUM(reserved), 0) AS total_reserved,
                COALESCE(SUM(CASE WHEN (on_hand - reserved) <= low_stock_threshold AND (on_hand - reserved) > 0 THEN 1 ELSE 0 END), 0) AS low_stock_count,
                COALESCE(SUM(CASE WHEN (on_hand - reserved) <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count
               FROM inventory_items"""
        ).fetchone()

        dispatched_raw = db.execute(
            """SELECT COALESCE(SUM(quantity_dispatched - quantity_delivered), 0) AS total_dispatched
               FROM allocations
               WHERE status IN ('Dispatched', 'Reserved')"""
        ).fetchone()

        pending_alloc_raw = db.execute(
            """SELECT COUNT(*) AS c 
               FROM emergency_requests 
               WHERE verification_status = 'Verified' AND status != 'Fulfilled'"""
        ).fetchone()

        total_on_hand = float(summary_raw["total_on_hand"])
        total_reserved = float(summary_raw["total_reserved"])
        total_available = max(0.0, total_on_hand - total_reserved)

        # Fetch distinct storage locations for filter dropdown
        location_rows = db.execute(
            "SELECT DISTINCT storage_location FROM inventory_items WHERE storage_location IS NOT NULL ORDER BY storage_location"
        ).fetchall()
        all_locations = [r["storage_location"] for r in location_rows]
        total_items_count = db.execute("SELECT COUNT(*) AS c FROM inventory_items").fetchone()["c"]

    return {
        "total": total,
        "items": paginated_items,
        "locations": all_locations,
        "summary": {
            "total_on_hand": round(total_on_hand, 2),
            "total_reserved": round(total_reserved, 2),
            "total_available": round(total_available, 2),
            "total_dispatched": round(float(dispatched_raw["total_dispatched"]), 2),
            "low_stock_count": int(summary_raw["low_stock_count"]),
            "out_of_stock_count": int(summary_raw["out_of_stock_count"]),
            "pending_allocation_requests": int(pending_alloc_raw["c"]),
            "total_items_count": int(total_items_count),
        }
    }


@app.post("/api/inventory", status_code=status.HTTP_201_CREATED)
def create_inventory_item(payload: InventoryItemCreate):
    now = datetime.now(timezone.utc).isoformat()
    item_code = payload.item_code.strip() if payload.item_code and payload.item_code.strip() else f"INV-{uuid.uuid4().hex[:6].upper()}"

    with closing(connection()) as db:
        # Check duplicate item_code
        exists = db.execute("SELECT id FROM inventory_items WHERE item_code = ?", (item_code,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail=f"Inventory item with code '{item_code}' already exists")

        cursor = db.execute(
            """INSERT INTO inventory_items
               (item_code, name, category, unit, storage_location, on_hand, reserved, low_stock_threshold, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?)""",
            (item_code, payload.name.strip(), payload.category.value, payload.unit.strip().lower(),
             payload.storage_location.strip(), payload.on_hand, payload.low_stock_threshold, now, now)
        )
        new_id = cursor.lastrowid

        if payload.on_hand > 0:
            db.execute(
                """INSERT INTO stock_movements
                   (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
                   VALUES (?, ?, 'INITIAL_STOCK', ?, 'INIT', 'Initial recorded inventory balance', 'Operator', ?)""",
                (f"MOV-INIT-{uuid.uuid4().hex[:6].upper()}", new_id, payload.on_hand, now)
            )

        db.commit()
        row = db.execute("SELECT * FROM inventory_items WHERE id = ?", (new_id,)).fetchone()

    return inventory_item_response(row)


@app.get("/api/inventory/{item_id}")
def get_inventory_item(item_id: int):
    with closing(connection()) as db:
        row = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        movements = db.execute(
            "SELECT * FROM stock_movements WHERE inventory_item_id = ? ORDER BY created_at DESC LIMIT 50",
            (item_id,)
        ).fetchall()

        allocations = db.execute(
            """SELECT a.*, r.household_label, r.category as request_category, r.severity as request_severity
               FROM allocations a
               LEFT JOIN emergency_requests r ON r.request_id = a.request_id
               WHERE a.inventory_item_id = ?
               ORDER BY a.created_at DESC""",
            (item_id,)
        ).fetchall()

    item_dict = inventory_item_response(row)
    item_dict["movements"] = [dict(m) for m in movements]
    item_dict["allocations"] = [dict(a) for a in allocations]
    return item_dict


@app.patch("/api/inventory/{item_id}")
def update_inventory_item(item_id: int, payload: InventoryItemUpdate):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        current = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        name = payload.name.strip() if payload.name else current["name"]
        cat = payload.category.value if payload.category else current["category"]
        unit = payload.unit.strip().lower() if payload.unit else current["unit"]
        loc = payload.storage_location.strip() if payload.storage_location else current["storage_location"]
        thresh = payload.low_stock_threshold if payload.low_stock_threshold is not None else current["low_stock_threshold"]

        # Prevent changing unit if active non-delivered allocations exist
        if payload.unit and payload.unit.strip().lower() != current["unit"]:
            active_allocs = db.execute(
                "SELECT COUNT(*) AS c FROM allocations WHERE inventory_item_id = ? AND status IN ('Reserved', 'Dispatched')",
                (item_id,)
            ).fetchone()["c"]
            if active_allocs > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot change unit of measurement while item has {active_allocs} active allocation commitments"
                )

        db.execute(
            """UPDATE inventory_items 
               SET name = ?, category = ?, unit = ?, storage_location = ?, low_stock_threshold = ?, updated_at = ?
               WHERE id = ?""",
            (name, cat, unit, loc, thresh, now, item_id)
        )
        db.commit()
        updated = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()

    return inventory_item_response(updated)


@app.post("/api/inventory/{item_id}/receive")
def receive_stock(item_id: int, payload: StockReceiveIn):
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Receive quantity must be strictly positive")

    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        # Idempotency check
        if payload.idempotency_key:
            existing = db.execute(
                "SELECT * FROM stock_movements WHERE inventory_item_id = ? AND reference_id = ?",
                (item_id, payload.idempotency_key)
            ).fetchone()
            if existing:
                return {
                    "item": inventory_item_response(item),
                    "movement": dict(existing),
                    "is_retry": True,
                    "message": "Duplicate receive operation ignored; returned current stock idempotently"
                }

        db.execute(
            "UPDATE inventory_items SET on_hand = on_hand + ?, updated_at = ? WHERE id = ?",
            (payload.quantity, now, item_id)
        )
        movement_id = f"MOV-RCV-{uuid.uuid4().hex[:8].upper()}"
        ref_id = payload.idempotency_key or payload.reference or ""
        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'INCOMING', ?, ?, ?, ?, ?)""",
            (movement_id, item_id, payload.quantity, ref_id, payload.reason or "Incoming stock receipt", payload.operator or "Operator", now)
        )
        db.commit()

        updated = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        mov = db.execute("SELECT * FROM stock_movements WHERE movement_id = ?", (movement_id,)).fetchone()

    return {
        "item": inventory_item_response(updated),
        "movement": dict(mov),
        "is_retry": False,
        "message": f"Successfully received {payload.quantity} {item['unit']} of {item['name']}"
    }


@app.post("/api/inventory/{item_id}/adjust")
def adjust_stock(item_id: int, payload: StockAdjustIn):
    if payload.new_on_hand < 0:
        raise HTTPException(status_code=400, detail="Physical on-hand stock cannot be negative")

    if not payload.reason or len(payload.reason.strip()) < 3:
        raise HTTPException(status_code=400, detail="A mandatory justification reason (min 3 chars) is required for stock corrections")

    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        reserved = float(item["reserved"])
        if payload.new_on_hand < reserved:
            raise HTTPException(
                status_code=400,
                detail=f"Physical stock ({payload.new_on_hand}) cannot be adjusted below current reserved commitments ({reserved})"
            )

        delta = round(payload.new_on_hand - float(item["on_hand"]), 2)
        db.execute(
            "UPDATE inventory_items SET on_hand = ?, updated_at = ? WHERE id = ?",
            (payload.new_on_hand, now, item_id)
        )
        movement_id = f"MOV-ADJ-{uuid.uuid4().hex[:8].upper()}"
        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'CORRECTION', ?, '', ?, ?, ?)""",
            (movement_id, item_id, delta, payload.reason.strip(), payload.operator or "Coordinator", now)
        )
        db.commit()

        updated = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        mov = db.execute("SELECT * FROM stock_movements WHERE movement_id = ?", (movement_id,)).fetchone()

    return {
        "item": inventory_item_response(updated),
        "movement": dict(mov),
        "delta": delta,
        "message": f"Stock level corrected from {item['on_hand']} to {payload.new_on_hand} ({'+' if delta >= 0 else ''}{delta} {item['unit']})"
    }


@app.get("/api/inventory/{item_id}/movements")
def get_item_movements(item_id: int, limit: int = Query(default=100, ge=1, le=500)):
    with closing(connection()) as db:
        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (item_id,)).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        rows = db.execute(
            "SELECT * FROM stock_movements WHERE inventory_item_id = ? ORDER BY created_at DESC LIMIT ?",
            (item_id, limit)
        ).fetchall()

    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Relief Allocations (Requests <-> Inventory)
# ---------------------------------------------------------------------------

@app.get("/api/allocations")
def list_allocations(
    request_id: Optional[str] = None,
    inventory_item_id: Optional[int] = None,
    status: Optional[str] = None
):
    with closing(connection()) as db:
        conditions = []
        params = []
        if request_id:
            conditions.append("a.request_id = ?")
            params.append(request_id)
        if inventory_item_id:
            conditions.append("a.inventory_item_id = ?")
            params.append(inventory_item_id)
        if status and status.upper() != "ALL":
            conditions.append("a.status = ?")
            params.append(status)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit,
                         i.storage_location, i.item_code, r.household_label, r.zone_id as request_zone
                  FROM allocations a
                  JOIN inventory_items i ON i.id = a.inventory_item_id
                  LEFT JOIN emergency_requests r ON r.request_id = a.request_id
                  {where_clause}
                  ORDER BY a.created_at DESC"""

        rows = db.execute(sql, params).fetchall()

    return [dict(r) for r in rows]


@app.post("/api/allocations", status_code=status.HTTP_201_CREATED)
def create_allocation(payload: AllocationCreateIn, response: Response):
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Allocation quantity must be strictly positive")

    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        # Check idempotency
        if payload.idempotency_key:
            existing = db.execute(
                """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
                   FROM allocations a
                   JOIN inventory_items i ON i.id = a.inventory_item_id
                   WHERE a.notes LIKE ?""",
                (f"%[IDEMP:{payload.idempotency_key}]%",)
            ).fetchone()
            if existing:
                response.status_code = status.HTTP_200_OK
                return {
                    "allocation": dict(existing),
                    "is_retry": True,
                    "message": "Duplicate reservation request; returned existing allocation idempotently"
                }

        # Check emergency request
        req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (payload.request_id,)).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail=f"Emergency request not found: {payload.request_id}")

        if req["verification_status"] == "Rejected":
            raise HTTPException(status_code=400, detail="Cannot allocate inventory to a rejected emergency request")

        # Check inventory item
        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (payload.inventory_item_id,)).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {payload.inventory_item_id}")

        available = float(item["on_hand"]) - float(item["reserved"])
        if available < payload.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient available stock for {item['name']}. Available: {round(available, 2)} {item['unit']}, Requested: {payload.quantity} {item['unit']}"
            )

        # Atomic conditional update reserving stock
        cursor = db.execute(
            """UPDATE inventory_items
               SET reserved = reserved + ?, updated_at = ?
               WHERE id = ? AND (on_hand - reserved) >= ?""",
            (payload.quantity, now, payload.inventory_item_id, payload.quantity)
        )
        if cursor.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=400, detail="Stock availability conflict: reservation failed due to competing reservation")

        allocation_id = f"ALC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        notes_text = payload.notes.strip() if payload.notes else ""
        if payload.idempotency_key:
            notes_text = f"{notes_text} [IDEMP:{payload.idempotency_key}]".strip()

        db.execute(
            """INSERT INTO allocations
               (allocation_id, request_id, inventory_item_id, quantity_reserved, quantity_dispatched, quantity_delivered, status, allocated_by, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0.0, 0.0, 'Reserved', ?, ?, ?, ?)""",
            (allocation_id, payload.request_id, payload.inventory_item_id, payload.quantity,
             payload.allocated_by or "Coordinator", notes_text, now, now)
        )

        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'ALLOCATION_RESERVED', ?, ?, ?, ?, ?)""",
            (f"MOV-ALC-{uuid.uuid4().hex[:8].upper()}", payload.inventory_item_id, payload.quantity,
             allocation_id, f"Stock reserved for emergency request {payload.request_id}", payload.allocated_by or "Coordinator", now)
        )

        # If request was Verified, advance to Assigned
        if req["status"] in ("Verified", "Pending Verification"):
            db.execute(
                "UPDATE emergency_requests SET status = 'Assigned', updated_at = ? WHERE request_id = ?",
                (now, payload.request_id)
            )
            db.execute(
                """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
                   VALUES (?, 'STATUS_CHANGE', ?, 'Assigned', ?, ?, ?)""",
                (payload.request_id, req["status"], payload.allocated_by or "Coordinator",
                 f"Relief stock reserved: {payload.quantity} {item['unit']} of {item['name']} ({allocation_id})", now)
            )

        db.commit()

        row = db.execute(
            """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
               FROM allocations a
               JOIN inventory_items i ON i.id = a.inventory_item_id
               WHERE a.allocation_id = ?""",
            (allocation_id,)
        ).fetchone()

    return {
        "allocation": dict(row),
        "is_retry": False,
        "message": f"Successfully reserved {payload.quantity} {item['unit']} of {item['name']} for request {payload.request_id}"
    }


@app.post("/api/allocations/{allocation_id}/dispatch")
def dispatch_allocation(allocation_id: str, payload: AllocationActionIn):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        alloc = db.execute("SELECT * FROM allocations WHERE allocation_id = ?", (allocation_id,)).fetchone()
        if not alloc:
            raise HTTPException(status_code=404, detail=f"Allocation not found: {allocation_id}")

        if alloc["status"] == "Cancelled":
            raise HTTPException(status_code=400, detail="Cannot dispatch a cancelled allocation")

        rem_reserved = float(alloc["quantity_reserved"]) - float(alloc["quantity_dispatched"])
        if rem_reserved <= 0:
            raise HTTPException(status_code=400, detail="Allocation has already been fully dispatched")

        qty = float(payload.quantity) if payload.quantity is not None else rem_reserved
        if qty <= 0 or qty > rem_reserved:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid dispatch quantity: {qty}. Max reservable remaining to dispatch: {rem_reserved}"
            )

        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (alloc["inventory_item_id"],)).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Associated inventory item not found")

        # Atomic deduction: reduce on_hand and reserved
        cursor = db.execute(
            """UPDATE inventory_items
               SET on_hand = on_hand - ?, reserved = reserved - ?, updated_at = ?
               WHERE id = ? AND on_hand >= ? AND reserved >= ?""",
            (qty, qty, now, alloc["inventory_item_id"], qty, qty)
        )
        if cursor.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=400, detail="Stock accounting invariant error: unable to deduct from on_hand or reserved")

        new_dispatched = float(alloc["quantity_dispatched"]) + qty
        new_status = "Dispatched" if new_dispatched >= float(alloc["quantity_reserved"]) else "Reserved"

        db.execute(
            """UPDATE allocations
               SET quantity_dispatched = ?, status = ?, updated_at = ?
               WHERE allocation_id = ?""",
            (new_dispatched, new_status, now, allocation_id)
        )

        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'RESERVATION_DISPATCHED', ?, ?, ?, ?, ?)""",
            (f"MOV-DSP-{uuid.uuid4().hex[:8].upper()}", alloc["inventory_item_id"], -qty, allocation_id,
             payload.reason or f"Dispatched for request {alloc['request_id']}", payload.operator or "Coordinator", now)
        )

        # Advance emergency request status to In Progress
        req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (alloc["request_id"],)).fetchone()
        if req and req["status"] in ("Verified", "Assigned"):
            db.execute(
                "UPDATE emergency_requests SET status = 'In Progress', updated_at = ? WHERE request_id = ?",
                (now, alloc["request_id"])
            )
            db.execute(
                """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
                   VALUES (?, 'STATUS_CHANGE', ?, 'In Progress', ?, ?, ?)""",
                (alloc["request_id"], req["status"], payload.operator or "Coordinator",
                 f"Relief supplies dispatched from warehouse: {qty} {item['unit']} of {item['name']}", now)
            )

        db.commit()

        row = db.execute(
            """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
               FROM allocations a
               JOIN inventory_items i ON i.id = a.inventory_item_id
               WHERE a.allocation_id = ?""",
            (allocation_id,)
        ).fetchone()

    return {
        "allocation": dict(row),
        "dispatched_qty": qty,
        "message": f"Successfully dispatched {qty} {item['unit']} of {item['name']}"
    }


@app.post("/api/allocations/{allocation_id}/deliver")
def deliver_allocation(allocation_id: str, payload: AllocationActionIn):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        alloc = db.execute("SELECT * FROM allocations WHERE allocation_id = ?", (allocation_id,)).fetchone()
        if not alloc:
            raise HTTPException(status_code=404, detail=f"Allocation not found: {allocation_id}")

        if alloc["status"] == "Cancelled":
            raise HTTPException(status_code=400, detail="Cannot record delivery for a cancelled allocation")

        rem_dispatched = float(alloc["quantity_dispatched"]) - float(alloc["quantity_delivered"])
        if rem_dispatched <= 0:
            raise HTTPException(status_code=400, detail="No remaining dispatched supplies awaiting delivery confirmation")

        qty = float(payload.quantity) if payload.quantity is not None else rem_dispatched
        if qty <= 0 or qty > rem_dispatched:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid delivered quantity: {qty}. Max deliverable remaining: {rem_dispatched}"
            )

        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (alloc["inventory_item_id"],)).fetchone()

        # Update allocation delivered quantity. Note: physical stock was ALREADY deducted upon dispatch!
        new_delivered = float(alloc["quantity_delivered"]) + qty
        new_status = "Delivered" if (new_delivered >= float(alloc["quantity_dispatched"]) and float(alloc["quantity_dispatched"]) >= float(alloc["quantity_reserved"])) else alloc["status"]

        db.execute(
            """UPDATE allocations
               SET quantity_delivered = ?, status = ?, updated_at = ?
               WHERE allocation_id = ?""",
            (new_delivered, new_status, now, allocation_id)
        )

        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'DELIVERED', ?, ?, ?, ?, ?)""",
            (f"MOV-DLV-{uuid.uuid4().hex[:8].upper()}", alloc["inventory_item_id"], qty, allocation_id,
             payload.reason or f"Delivery confirmed for request {alloc['request_id']}", payload.operator or "Coordinator", now)
        )

        # Audit event in request history
        req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (alloc["request_id"],)).fetchone()
        if req:
            unit_name = item["unit"] if item else "units"
            item_name = item["name"] if item else "supplies"
            db.execute(
                """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
                   VALUES (?, 'DELIVERY_CONFIRMED', ?, ?, ?, ?, ?)""",
                (alloc["request_id"], req["status"], req["status"], payload.operator or "Coordinator",
                 f"Relief delivery confirmed: {qty} {unit_name} of {item_name}", now)
            )

        db.commit()

        row = db.execute(
            """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
               FROM allocations a
               JOIN inventory_items i ON i.id = a.inventory_item_id
               WHERE a.allocation_id = ?""",
            (allocation_id,)
        ).fetchone()

    return {
        "allocation": dict(row),
        "delivered_qty": qty,
        "message": f"Successfully recorded delivery of {qty} supplies to recipient"
    }


@app.post("/api/allocations/{allocation_id}/cancel")
def cancel_allocation(allocation_id: str, payload: AllocationActionIn):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        alloc = db.execute("SELECT * FROM allocations WHERE allocation_id = ?", (allocation_id,)).fetchone()
        if not alloc:
            raise HTTPException(status_code=404, detail=f"Allocation not found: {allocation_id}")

        if alloc["status"] == "Cancelled":
            raise HTTPException(status_code=400, detail="Allocation is already cancelled")

        rem_reserved = float(alloc["quantity_reserved"]) - float(alloc["quantity_dispatched"])
        if rem_reserved <= 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot cancel allocation: all reserved supplies have already been dispatched from warehouse"
            )

        # Atomic release of reserved stock
        cursor = db.execute(
            """UPDATE inventory_items
               SET reserved = reserved - ?, updated_at = ?
               WHERE id = ? AND reserved >= ?""",
            (rem_reserved, now, alloc["inventory_item_id"], rem_reserved)
        )
        if cursor.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=400, detail="Stock accounting invariant error: unable to release reserved stock")

        db.execute(
            """UPDATE allocations
               SET quantity_reserved = quantity_dispatched, status = 'Cancelled', updated_at = ?
               WHERE allocation_id = ?""",
            (now, allocation_id)
        )

        item = db.execute("SELECT * FROM inventory_items WHERE id = ?", (alloc["inventory_item_id"],)).fetchone()
        unit_name = item["unit"] if item else "units"
        item_name = item["name"] if item else "supplies"

        db.execute(
            """INSERT INTO stock_movements
               (movement_id, inventory_item_id, movement_type, quantity, reference_id, reason, operator, created_at)
               VALUES (?, ?, 'RESERVATION_CANCELLED', ?, ?, ?, ?, ?)""",
            (f"MOV-CNC-{uuid.uuid4().hex[:8].upper()}", alloc["inventory_item_id"], -rem_reserved, allocation_id,
             payload.reason or "Allocation reservation cancelled by coordinator", payload.operator or "Coordinator", now)
        )

        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, 'ALLOCATION_CANCELLED', '', '', ?, ?, ?)""",
            (alloc["request_id"], payload.operator or "Coordinator",
             f"Released reservation of {rem_reserved} {unit_name} of {item_name} ({allocation_id})", now)
        )

        db.commit()

        row = db.execute(
            """SELECT a.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.storage_location, i.item_code
               FROM allocations a
               JOIN inventory_items i ON i.id = a.inventory_item_id
               WHERE a.allocation_id = ?""",
            (allocation_id,)
        ).fetchone()

    return {
        "allocation": dict(row),
        "released_qty": rem_reserved,
        "message": f"Successfully cancelled reservation and released {rem_reserved} {unit_name} back to available inventory"
    }


@app.post("/api/inventory/seed")
def seed_inventory_endpoint():
    with closing(connection()) as db:
        _seed_demo_inventory(db)
        db.commit()
        count = db.execute("SELECT COUNT(*) AS c FROM inventory_items").fetchone()["c"]
    return {"status": "ok", "items_seeded": count}


# ---------------------------------------------------------------------------
# Phase 3: Volunteers, Response Teams, and Task Assignment Endpoints
# ---------------------------------------------------------------------------

def _seed_demo_teams_and_volunteers(db: sqlite3.Connection):
    now = datetime.now(timezone.utc).isoformat()
    teams_data = [
        ("TEAM-ALPHA", "Nagpur Water Rescue Unit", "Water Rescue & Evacuation",
         "Swiftwater Rescue, Boat Navigation, CPR, Water Safety",
         "Zodiac Inflatable Boat, 10 Type-III Lifejackets, Throw Bags, Waterproof Radios, Sonar",
         "Available", "Ambazari Lake Rescue Station", "Ambazari Sector Base (Synthetic Demo)",
         "Capt. Rajesh Sharma", "+91 98230 11221"),
        ("TEAM-BRAVO", "Emergency Medical Response Corps", "Field Medical Support",
         "Trauma Triage, Advanced First Aid, Hypothermia Treatment, Waterborne Disease Care",
         "Mobile Medical Triage Kits, Portable Defibrillator, Foldable Stretchers, Oxygen Kit",
         "Available", "Dharampeth Zonal Medical Clinic", "Dharampeth Hub (Synthetic Demo)",
         "Dr. Sunita Deshmukh", "+91 98230 22332"),
        ("TEAM-CHARLIE", "Central Logistics & Supply Transport", "Relief Supply Logistics",
         "High-Clearance Transport, Heavy Cargo Handling, Safe Route Navigation, Bulk Distribution",
         "High-Clearance 4x4 Supply Truck, Heavy Waterproof Tarpaulins, Winch, Cargo Straps",
         "Available", "Central Relief Depot - Sitabuldi", "Sitabuldi Depot (Synthetic Demo)",
         "Amitabh Verma", "+91 98230 33443"),
        ("TEAM-DELTA", "Urban Evacuation Squad", "Search & Vulnerable Evacuation",
         "Elderly & Disabled Evacuation, Building Sweep, Door-to-Door Alerting, Stretcher Evac",
         "All-Terrain Rescue Van, Megaphones, Emergency Stretchers, Thermal Blankets",
         "Available", "Lakadganj Community Post", "Lakadganj Post (Synthetic Demo)",
         "Pooja Kulkarni", "+91 98230 44554"),
        ("TEAM-ECHO", "Reconnaissance & Drone Scout Unit", "Hazard Assessment",
         "Drone Aerial Reconnaissance, Water Depth Mapping, Structural Integrity Check",
         "Thermal Surveillance Quadcopter, Sonar Depth Probe, Satellite Communicator",
         "Offline", "Nag River Basin Watchpost", "Nag River Sector (Synthetic Demo)",
         "Vikram Jadhav", "+91 98230 55665"),
    ]
    for tid, name, ttype, skills, eq, status_val, base, loc, ldr, phone in teams_data:
        db.execute(
            """INSERT OR IGNORE INTO response_teams 
               (team_id, name, team_type, skills, equipment, availability_status, base_location, last_known_location, leader_name, contact_number, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tid, name, ttype, skills, eq, status_val, base, loc, ldr, phone, now, now)
        )

    volunteers_data = [
        ("VOL-001", "Aarav Patel", "+91 98211 10001", "TEAM-ALPHA", "Water Rescue, CPR & First Aid",
         "Available", "Ambazari (Synthetic Demo)", "Ambazari Lake Post (Synthetic Demo)", "Experienced river rafter and CPR certified"),
        ("VOL-002", "Priya Nair", "+91 98211 10002", "TEAM-ALPHA", "Inflatable Boat Pilot, Navigation",
         "Available", "Ambazari (Synthetic Demo)", "Ambazari Lake Post (Synthetic Demo)", "Boat handling certified"),
        ("VOL-003", "Dr. Rohan Joshi", "+91 98211 10003", "TEAM-BRAVO", "Emergency Medicine, Trauma Triage",
         "Available", "Dharampeth (Synthetic Demo)", "Dharampeth Clinic (Synthetic Demo)", "ER Physician volunteer"),
        ("VOL-004", "Ananya Iyer", "+91 98211 10004", "TEAM-BRAVO", "Field Nursing, First Aid, Medical Supplies",
         "Available", "Dharampeth (Synthetic Demo)", "Dharampeth Clinic (Synthetic Demo)", "Registered nurse"),
        ("VOL-005", "Ganesh Rao", "+91 98211 10005", "TEAM-CHARLIE", "Heavy Vehicle Driving, Cargo Logistics",
         "Available", "Sitabuldi (Synthetic Demo)", "Sitabuldi Depot (Synthetic Demo)", "Commercial heavy vehicle license"),
        ("VOL-006", "Meera Sen", "+91 98211 10006", "TEAM-DELTA", "Community Evacuation, Marathi & Hindi Translation",
         "Available", "Lakadganj (Synthetic Demo)", "Lakadganj Community Post (Synthetic Demo)", "Community organizer"),
        ("VOL-007", "Devendra Shinde", "+91 98211 10007", None, "General Assistance, Food Logistics, Shelter Support",
         "Available", "Civil Lines (Synthetic Demo)", "Civil Lines Relief Center (Synthetic Demo)", "Independent volunteer"),
        ("VOL-008", "Kavita Wankhede", "+91 98211 10008", None, "First Aid, HAM Radio Communications",
         "Offline", "Pardi (Synthetic Demo)", "Pardi Sector (Synthetic Demo)", "HAM operator, currently off shift"),
    ]
    for vid, vname, vphone, tid, vskills, vstatus, vzone, vloc, vnotes in volunteers_data:
        db.execute(
            """INSERT OR IGNORE INTO volunteers
               (volunteer_id, name, contact, team_id, skills, availability_status, current_zone, last_known_location, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (vid, vname, vphone, tid, vskills, vstatus, vzone, vloc, vnotes, now, now)
        )


@app.get("/api/teams")
def list_teams(status: Optional[str] = None, search: Optional[str] = None):
    with closing(connection()) as db:
        query = "SELECT * FROM response_teams WHERE 1=1"
        params = []
        if status and status.upper() != "ALL":
            query += " AND availability_status = ?"
            params.append(status)
        if search:
            query += " AND (name LIKE ? OR skills LIKE ? OR equipment LIKE ? OR base_location LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s, s])
        
        query += " ORDER BY name ASC"
        team_rows = db.execute(query, params).fetchall()

        teams = []
        for r in team_rows:
            t = dict(r)
            # Count members
            member_count = db.execute("SELECT COUNT(*) AS c FROM volunteers WHERE team_id = ?", (t["team_id"],)).fetchone()["c"]
            t["members_count"] = member_count

            # Active assignment if any
            active_task = db.execute(
                """SELECT assignment_id, request_id, task_type, task_description, priority, destination, status, created_at
                   FROM task_assignments
                   WHERE assignee_id = ? AND status NOT IN ('Completed', 'Cancelled')
                   ORDER BY created_at DESC LIMIT 1""",
                (t["team_id"],)
            ).fetchone()
            t["current_assignment"] = dict(active_task) if active_task else None
            teams.append(t)

        summary_raw = db.execute(
            """SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN availability_status = 'Available' THEN 1 ELSE 0 END) AS available,
                SUM(CASE WHEN availability_status = 'Assigned' THEN 1 ELSE 0 END) AS assigned,
                SUM(CASE WHEN availability_status = 'Busy' THEN 1 ELSE 0 END) AS busy,
                SUM(CASE WHEN availability_status = 'Offline' THEN 1 ELSE 0 END) AS offline
               FROM response_teams"""
        ).fetchone()

    return {
        "teams": teams,
        "summary": {
            "total_teams": summary_raw["total"] or 0,
            "available_teams": summary_raw["available"] or 0,
            "assigned_teams": summary_raw["assigned"] or 0,
            "busy_teams": summary_raw["busy"] or 0,
            "offline_teams": summary_raw["offline"] or 0,
        }
    }


@app.post("/api/teams", status_code=status.HTTP_201_CREATED)
def create_team(payload: ResponseTeamCreate):
    now = datetime.now(timezone.utc).isoformat()
    team_id = payload.team_id.strip() if payload.team_id and payload.team_id.strip() else f"TEAM-{uuid.uuid4().hex[:6].upper()}"

    with closing(connection()) as db:
        existing = db.execute("SELECT id FROM response_teams WHERE team_id = ?", (team_id,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Team with ID '{team_id}' already exists.")

        db.execute(
            """INSERT INTO response_teams 
               (team_id, name, team_type, skills, equipment, availability_status, base_location, last_known_location, leader_name, contact_number, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?, ?)""",
            (team_id, payload.name.strip(), payload.team_type.strip(), payload.skills.strip(),
             payload.equipment.strip(), payload.base_location.strip(),
             f"{payload.base_location.strip()} (Synthetic Demo)", payload.leader_name.strip(),
             payload.contact_number.strip(), now, now)
        )
        db.commit()

        row = db.execute("SELECT * FROM response_teams WHERE team_id = ?", (team_id,)).fetchone()
        res = dict(row)
        res["members_count"] = 0
        res["current_assignment"] = None
    return res


@app.get("/api/teams/{team_id}")
def get_team(team_id: str):
    with closing(connection()) as db:
        team_row = db.execute("SELECT * FROM response_teams WHERE team_id = ?", (team_id,)).fetchone()
        if not team_row:
            raise HTTPException(status_code=404, detail=f"Response team not found: {team_id}")
        
        members = db.execute("SELECT * FROM volunteers WHERE team_id = ? ORDER BY name ASC", (team_id,)).fetchall()
        assignments = db.execute(
            """SELECT * FROM task_assignments WHERE assignee_id = ? ORDER BY created_at DESC""",
            (team_id,)
        ).fetchall()

        t = dict(team_row)
        t["members_count"] = len(members)
        active_task = next((dict(a) for a in assignments if a["status"] not in ("Completed", "Cancelled")), None)
        t["current_assignment"] = active_task

    return {
        "team": t,
        "members": [dict(m) for m in members],
        "assignments": [dict(a) for a in assignments]
    }


@app.patch("/api/teams/{team_id}")
def update_team(team_id: str, payload: ResponseTeamUpdate):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        team_row = db.execute("SELECT * FROM response_teams WHERE team_id = ?", (team_id,)).fetchone()
        if not team_row:
            raise HTTPException(status_code=404, detail=f"Response team not found: {team_id}")
        
        updates = []
        params = []
        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name.strip())
        if payload.team_type is not None:
            updates.append("team_type = ?")
            params.append(payload.team_type.strip())
        if payload.skills is not None:
            updates.append("skills = ?")
            params.append(payload.skills.strip())
        if payload.equipment is not None:
            updates.append("equipment = ?")
            params.append(payload.equipment.strip())
        if payload.base_location is not None:
            updates.append("base_location = ?")
            params.append(payload.base_location.strip())
            updates.append("last_known_location = ?")
            params.append(f"{payload.base_location.strip()} (Synthetic Demo)")
        if payload.leader_name is not None:
            updates.append("leader_name = ?")
            params.append(payload.leader_name.strip())
        if payload.contact_number is not None:
            updates.append("contact_number = ?")
            params.append(payload.contact_number.strip())
        if payload.availability_status is not None:
            # If changing to Offline or Busy while having active task, enforce consistency
            if payload.availability_status == AvailabilityStatus.OFFLINE:
                active = db.execute(
                    "SELECT COUNT(*) AS c FROM task_assignments WHERE assignee_id = ? AND status NOT IN ('Completed', 'Cancelled')",
                    (team_id,)
                ).fetchone()["c"]
                if active > 0:
                    raise HTTPException(status_code=400, detail="Cannot mark team Offline while they have active operational tasks in progress.")
            updates.append("availability_status = ?")
            params.append(payload.availability_status.value)
        
        if updates:
            updates.append("updated_at = ?")
            params.append(now)
            params.append(team_id)
            db.execute(f"UPDATE response_teams SET {', '.join(updates)} WHERE team_id = ?", params)
            db.commit()

        updated_row = db.execute("SELECT * FROM response_teams WHERE team_id = ?", (team_id,)).fetchone()
    return dict(updated_row)


@app.get("/api/volunteers")
def list_volunteers(
    team_id: Optional[str] = None,
    availability_status: Optional[str] = None,
    skill: Optional[str] = None,
    search: Optional[str] = None
):
    with closing(connection()) as db:
        query = """
            SELECT v.*, t.name as team_name 
            FROM volunteers v 
            LEFT JOIN response_teams t ON t.team_id = v.team_id 
            WHERE 1=1
        """
        params = []
        if team_id:
            if team_id.upper() == "UNASSIGNED":
                query += " AND (v.team_id IS NULL OR v.team_id = '')"
            else:
                query += " AND v.team_id = ?"
                params.append(team_id)
        if availability_status and availability_status.upper() != "ALL":
            query += " AND v.availability_status = ?"
            params.append(availability_status)
        if skill:
            query += " AND v.skills LIKE ?"
            params.append(f"%{skill.strip()}%")
        if search:
            query += " AND (v.name LIKE ? OR v.skills LIKE ? OR v.contact LIKE ? OR v.notes LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s, s])

        query += " ORDER BY v.name ASC"
        rows = db.execute(query, params).fetchall()

        summary_raw = db.execute(
            """SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN availability_status = 'Available' THEN 1 ELSE 0 END) AS available,
                SUM(CASE WHEN availability_status = 'Assigned' THEN 1 ELSE 0 END) AS assigned,
                SUM(CASE WHEN availability_status = 'Busy' THEN 1 ELSE 0 END) AS busy,
                SUM(CASE WHEN availability_status = 'Offline' THEN 1 ELSE 0 END) AS offline,
                SUM(CASE WHEN team_id IS NULL OR team_id = '' THEN 1 ELSE 0 END) AS unassigned
               FROM volunteers"""
        ).fetchone()

    return {
        "volunteers": [dict(r) for r in rows],
        "summary": {
            "total_volunteers": summary_raw["total"] or 0,
            "available": summary_raw["available"] or 0,
            "assigned": summary_raw["assigned"] or 0,
            "busy": summary_raw["busy"] or 0,
            "offline": summary_raw["offline"] or 0,
            "unassigned": summary_raw["unassigned"] or 0,
        }
    }


@app.post("/api/volunteers", status_code=status.HTTP_201_CREATED)
def create_volunteer(payload: VolunteerCreate):
    now = datetime.now(timezone.utc).isoformat()
    vid = payload.volunteer_id.strip() if payload.volunteer_id and payload.volunteer_id.strip() else f"VOL-{uuid.uuid4().hex[:4].upper()}"

    with closing(connection()) as db:
        existing = db.execute("SELECT id FROM volunteers WHERE volunteer_id = ?", (vid,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Volunteer with ID '{vid}' already exists.")

        if payload.team_id:
            team = db.execute("SELECT id FROM response_teams WHERE team_id = ?", (payload.team_id,)).fetchone()
            if not team:
                raise HTTPException(status_code=404, detail=f"Target team '{payload.team_id}' not found.")

        loc = f"{payload.current_zone.strip()} (Synthetic Demo)"
        db.execute(
            """INSERT INTO volunteers 
               (volunteer_id, name, contact, team_id, skills, availability_status, current_zone, last_known_location, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?)""",
            (vid, payload.name.strip(), payload.contact.strip(), payload.team_id,
             payload.skills.strip(), payload.current_zone.strip(), loc, payload.notes.strip(), now, now)
        )
        db.commit()

        row = db.execute(
            """SELECT v.*, t.name as team_name 
               FROM volunteers v 
               LEFT JOIN response_teams t ON t.team_id = v.team_id 
               WHERE v.volunteer_id = ?""",
            (vid,)
        ).fetchone()
    return dict(row)


@app.get("/api/volunteers/{volunteer_id}")
def get_volunteer(volunteer_id: str):
    with closing(connection()) as db:
        row = db.execute(
            """SELECT v.*, t.name as team_name 
               FROM volunteers v 
               LEFT JOIN response_teams t ON t.team_id = v.team_id 
               WHERE v.volunteer_id = ?""",
            (volunteer_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Volunteer not found: {volunteer_id}")

        assignments = db.execute(
            """SELECT * FROM task_assignments WHERE assignee_id = ? ORDER BY created_at DESC""",
            (volunteer_id,)
        ).fetchall()

    return {
        "volunteer": dict(row),
        "assignments": [dict(a) for a in assignments]
    }


@app.patch("/api/volunteers/{volunteer_id}")
def update_volunteer(volunteer_id: str, payload: VolunteerUpdate):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        row = db.execute("SELECT * FROM volunteers WHERE volunteer_id = ?", (volunteer_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Volunteer not found: {volunteer_id}")

        updates = []
        params = []
        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name.strip())
        if payload.contact is not None:
            updates.append("contact = ?")
            params.append(payload.contact.strip())
        if payload.team_id is not None:
            if payload.team_id.strip() == "":
                updates.append("team_id = NULL")
            else:
                team = db.execute("SELECT id FROM response_teams WHERE team_id = ?", (payload.team_id,)).fetchone()
                if not team:
                    raise HTTPException(status_code=404, detail=f"Team '{payload.team_id}' not found.")
                updates.append("team_id = ?")
                params.append(payload.team_id.strip())
        if payload.skills is not None:
            updates.append("skills = ?")
            params.append(payload.skills.strip())
        if payload.current_zone is not None:
            updates.append("current_zone = ?")
            params.append(payload.current_zone.strip())
            updates.append("last_known_location = ?")
            params.append(f"{payload.current_zone.strip()} (Synthetic Demo)")
        if payload.notes is not None:
            updates.append("notes = ?")
            params.append(payload.notes.strip())
        if payload.availability_status is not None:
            if payload.availability_status == AvailabilityStatus.OFFLINE:
                active = db.execute(
                    "SELECT COUNT(*) AS c FROM task_assignments WHERE assignee_id = ? AND status NOT IN ('Completed', 'Cancelled')",
                    (volunteer_id,)
                ).fetchone()["c"]
                if active > 0:
                    raise HTTPException(status_code=400, detail="Cannot mark volunteer Offline while they have active operational tasks in progress.")
            updates.append("availability_status = ?")
            params.append(payload.availability_status.value)

        if updates:
            updates.append("updated_at = ?")
            params.append(now)
            params.append(volunteer_id)
            db.execute(f"UPDATE volunteers SET {', '.join(updates)} WHERE volunteer_id = ?", params)
            db.commit()

        updated_row = db.execute(
            """SELECT v.*, t.name as team_name 
               FROM volunteers v 
               LEFT JOIN response_teams t ON t.team_id = v.team_id 
               WHERE v.volunteer_id = ?""",
            (volunteer_id,)
        ).fetchone()
    return dict(updated_row)


@app.get("/api/assignments")
def list_assignments(
    request_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None
):
    with closing(connection()) as db:
        query = """
            SELECT t.*, 
                   r.household_label, r.category as request_category, r.severity as request_severity, r.zone_id,
                   a.quantity_reserved, a.quantity_dispatched, a.quantity_delivered,
                   i.name as item_name, i.unit as item_unit
            FROM task_assignments t
            JOIN emergency_requests r ON r.request_id = t.request_id
            LEFT JOIN allocations a ON a.allocation_id = t.allocation_id
            LEFT JOIN inventory_items i ON i.id = a.inventory_item_id
            WHERE 1=1
        """
        params = []
        if request_id:
            query += " AND t.request_id = ?"
            params.append(request_id)
        if assignee_id:
            query += " AND t.assignee_id = ?"
            params.append(assignee_id)
        if status and status.upper() != "ALL":
            query += " AND t.status = ?"
            params.append(status)
        if task_type and task_type.upper() != "ALL":
            query += " AND t.task_type = ?"
            params.append(task_type)

        query += " ORDER BY t.created_at DESC"
        rows = db.execute(query, params).fetchall()

        assignments = []
        for r in rows:
            item = dict(r)
            evs = db.execute(
                "SELECT * FROM assignment_events WHERE assignment_id = ? ORDER BY timestamp ASC",
                (item["assignment_id"],)
            ).fetchall()
            item["events"] = [dict(e) for e in evs]
            assignments.append(item)

        summary_raw = db.execute(
            """SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'Assigned' THEN 1 ELSE 0 END) AS assigned,
                SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN status = 'En Route' THEN 1 ELSE 0 END) AS en_route,
                SUM(CASE WHEN status = 'Arrived' THEN 1 ELSE 0 END) AS arrived,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled
               FROM task_assignments"""
        ).fetchone()

    return {
        "assignments": assignments,
        "summary": {
            "total_tasks": summary_raw["total"] or 0,
            "assigned": summary_raw["assigned"] or 0,
            "accepted": summary_raw["accepted"] or 0,
            "en_route": summary_raw["en_route"] or 0,
            "arrived": summary_raw["arrived"] or 0,
            "completed": summary_raw["completed"] or 0,
            "cancelled": summary_raw["cancelled"] or 0,
        }
    }


@app.post("/api/assignments", status_code=status.HTTP_201_CREATED)
def create_assignment(payload: TaskAssignmentCreate):
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        # Rule 1: Check emergency request exists
        req = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (payload.request_id,)).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail=f"Emergency request not found: {payload.request_id}")

        # Rule 1: Only verified requests can receive operational assignments without explicit emergency override
        if req["verification_status"] != "Verified":
            if not payload.emergency_override or not payload.override_reason or len(payload.override_reason.strip()) < 5:
                raise HTTPException(
                    status_code=400,
                    detail="Only verified requests can receive operational assignments without an authorized emergency override and reason."
                )

        # Rule 2 & 7: Check assignee exists, is not offline, and has no conflicting active assignments
        if payload.assignee_type == AssigneeType.TEAM:
            assignee = db.execute("SELECT * FROM response_teams WHERE team_id = ?", (payload.assignee_id,)).fetchone()
        else:
            assignee = db.execute("SELECT * FROM volunteers WHERE volunteer_id = ?", (payload.assignee_id,)).fetchone()

        if not assignee:
            raise HTTPException(status_code=404, detail=f"{payload.assignee_type.value} '{payload.assignee_id}' not found.")

        if assignee["availability_status"] == "Offline":
            raise HTTPException(status_code=400, detail=f"Cannot assign offline {payload.assignee_type.value.lower()} '{assignee['name']}'.")

        if assignee["availability_status"] in ("Assigned", "Busy"):
            raise HTTPException(
                status_code=400,
                detail=f"{payload.assignee_type.value} '{assignee['name']}' already has an active assignment and cannot accept conflicting tasks."
            )

        # Also double check database for any non-completed, non-cancelled assignments for this assignee
        active_cnt = db.execute(
            "SELECT COUNT(*) AS c FROM task_assignments WHERE assignee_id = ? AND status NOT IN ('Completed', 'Cancelled')",
            (payload.assignee_id,)
        ).fetchone()["c"]
        if active_cnt > 0:
            raise HTTPException(
                status_code=400,
                detail=f"{payload.assignee_type.value} '{assignee['name']}' already has an active task assignment in progress."
            )

        # Rule 3: Prevent duplicate active assignment for the same delivery task/allocation
        if payload.allocation_id:
            alloc = db.execute("SELECT * FROM allocations WHERE allocation_id = ?", (payload.allocation_id,)).fetchone()
            if not alloc:
                raise HTTPException(status_code=404, detail=f"Relief allocation '{payload.allocation_id}' not found.")
            dup_alloc = db.execute(
                "SELECT COUNT(*) AS c FROM task_assignments WHERE allocation_id = ? AND status NOT IN ('Completed', 'Cancelled')",
                (payload.allocation_id,)
            ).fetchone()["c"]
            if dup_alloc > 0:
                raise HTTPException(status_code=400, detail=f"An active assignment already exists for relief allocation '{payload.allocation_id}'.")

        # Prevent duplicate active assignment for the same request + assignee
        dup_req = db.execute(
            "SELECT COUNT(*) AS c FROM task_assignments WHERE request_id = ? AND assignee_id = ? AND status NOT IN ('Completed', 'Cancelled')",
            (payload.request_id, payload.assignee_id)
        ).fetchone()["c"]
        if dup_req > 0:
            raise HTTPException(status_code=400, detail="This assignee already has an active operational task for this emergency request.")

        # Atomic Assignment Creation
        assignment_id = f"TSK-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

        db.execute(
            """INSERT INTO task_assignments 
               (assignment_id, request_id, assignee_type, assignee_id, assignee_name, task_type, task_description,
                priority, destination, allocation_id, status, assigned_by, notes, override_reason, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Assigned', ?, ?, ?, ?, ?)""",
            (assignment_id, payload.request_id, payload.assignee_type.value, payload.assignee_id,
             assignee["name"], payload.task_type.strip(), payload.task_description.strip(),
             payload.priority.value, payload.destination.strip(), payload.allocation_id,
             payload.assigned_by.strip() or "Coordinator", payload.notes.strip(),
             payload.override_reason.strip() if payload.emergency_override else "", now, now)
        )

        # Update assignee status to 'Assigned'
        if payload.assignee_type == AssigneeType.TEAM:
            db.execute("UPDATE response_teams SET availability_status = 'Assigned', updated_at = ? WHERE team_id = ?", (now, payload.assignee_id))
        else:
            db.execute("UPDATE volunteers SET availability_status = 'Assigned', updated_at = ? WHERE volunteer_id = ?", (now, payload.assignee_id))

        # Record assignment creation event
        event_id = f"EV-{uuid.uuid4().hex[:8].upper()}"
        initial_note = f"Task assigned to {payload.assignee_type.value} '{assignee['name']}': {payload.task_description[:60]}"
        if payload.emergency_override:
            initial_note += f" [Emergency Override Authorized: {payload.override_reason}]"

        db.execute(
            """INSERT INTO assignment_events 
               (event_id, assignment_id, action, previous_status, new_status, actor, note, simulated_coordinates, timestamp)
               VALUES (?, ?, 'Created', '', 'Assigned', ?, ?, ?, ?)""",
            (event_id, assignment_id, payload.assigned_by.strip() or "Coordinator",
             initial_note, assignee["last_known_location"], now)
        )

        # Record in request history
        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, 'TASK_ASSIGNED', ?, ?, ?, ?, ?)""",
            (payload.request_id, req["status"], req["status"], payload.assigned_by.strip() or "Coordinator",
             f"Operational task {assignment_id} assigned to {payload.assignee_type.value} '{assignee['name']}' ({payload.task_type})", now)
        )

        db.commit()

        row = db.execute("SELECT * FROM task_assignments WHERE assignment_id = ?", (assignment_id,)).fetchone()
        res = dict(row)
        evs = db.execute("SELECT * FROM assignment_events WHERE assignment_id = ? ORDER BY timestamp ASC", (assignment_id,)).fetchall()
        res["events"] = [dict(e) for e in evs]

    return res


@app.post("/api/assignments/{assignment_id}/action")
def update_assignment_action(assignment_id: str, payload: TaskAssignmentAction):
    now = datetime.now(timezone.utc).isoformat()
    action = payload.action.strip()

    with closing(connection()) as db:
        task = db.execute("SELECT * FROM task_assignments WHERE assignment_id = ?", (assignment_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail=f"Task assignment not found: {assignment_id}")

        current_status = task["status"]
        if current_status in ("Completed", "Cancelled") and action != "Reopen":
            raise HTTPException(status_code=400, detail=f"Task is already {current_status} and cannot be modified.")

        # Determine target status and validate transition
        simulated_coords = ""
        target_status = current_status

        if action.lower() in ("accept", "accepted"):
            if current_status not in ("Assigned", "Pending Assignment"):
                raise HTTPException(status_code=400, detail=f"Cannot accept task from status '{current_status}'.")
            target_status = "Accepted"
            simulated_coords = "Base Station Ready (Synthetic Demo)"

        elif action.lower() in ("en route", "enroute", "dispatch"):
            if current_status not in ("Assigned", "Accepted"):
                raise HTTPException(status_code=400, detail=f"Cannot dispatch/move en route from status '{current_status}'.")
            target_status = "En Route"
            simulated_coords = "21.1458, 79.0882 - En Route Waypoint (Synthetic Demo Simulation)"

        elif action.lower() in ("arrive", "arrived"):
            if current_status != "En Route":
                raise HTTPException(status_code=400, detail=f"Cannot mark arrived from status '{current_status}'. Must be En Route first.")
            target_status = "Arrived"
            simulated_coords = f"{task['destination']} (Synthetic Demo Destination Arrival)"

        elif action.lower() in ("complete", "completed"):
            if current_status not in ("Arrived", "En Route", "Accepted"):
                raise HTTPException(status_code=400, detail=f"Cannot complete task from status '{current_status}'.")
            target_status = "Completed"
            simulated_coords = f"{task['destination']} (Mission Completed - Synthetic Demo)"

            # Release assignee availability back to 'Available'
            if task["assignee_type"] == "Team":
                db.execute("UPDATE response_teams SET availability_status = 'Available', updated_at = ? WHERE team_id = ?", (now, task["assignee_id"]))
            else:
                db.execute("UPDATE volunteers SET availability_status = 'Available', updated_at = ? WHERE volunteer_id = ?", (now, task["assignee_id"]))

        elif action.lower() in ("cancel", "cancelled"):
            if not payload.reason or len(payload.reason.strip()) < 3:
                raise HTTPException(status_code=400, detail="A clear reason is required to cancel an assignment (minimum 3 characters).")
            target_status = "Cancelled"

            # Release assignee availability back to 'Available'
            if task["assignee_type"] == "Team":
                db.execute("UPDATE response_teams SET availability_status = 'Available', updated_at = ? WHERE team_id = ?", (now, task["assignee_id"]))
            else:
                db.execute("UPDATE volunteers SET availability_status = 'Available', updated_at = ? WHERE volunteer_id = ?", (now, task["assignee_id"]))

        else:
            raise HTTPException(status_code=400, detail=f"Unknown assignment action '{action}'. Supported: Accept, En Route, Arrive, Complete, Cancel.")

        # Update assignment status
        db.execute(
            "UPDATE task_assignments SET status = ?, updated_at = ? WHERE assignment_id = ?",
            (target_status, now, assignment_id)
        )

        # Record assignment event
        event_id = f"EV-{uuid.uuid4().hex[:8].upper()}"
        note_text = payload.note.strip() or f"Task transitioned to {target_status}"
        if action.lower() in ("cancel", "cancelled") and payload.reason:
            note_text = f"Cancelled: {payload.reason.strip()}" + (f" | {payload.note.strip()}" if payload.note else "")

        db.execute(
            """INSERT INTO assignment_events 
               (event_id, assignment_id, action, previous_status, new_status, actor, note, simulated_coordinates, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (event_id, assignment_id, action.capitalize(), current_status, target_status,
             payload.actor.strip() or "Coordinator", note_text, simulated_coords, now)
        )

        # Log into emergency request history
        db.execute(
            """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, 'TASK_UPDATE', '', '', ?, ?, ?)""",
            (task["request_id"], payload.actor.strip() or "Coordinator",
             f"Task {assignment_id} ({task['assignee_name']}): {current_status} -> {target_status} [{note_text[:50]}]", now)
        )

        db.commit()

        updated_task = db.execute("SELECT * FROM task_assignments WHERE assignment_id = ?", (assignment_id,)).fetchone()
        evs = db.execute("SELECT * FROM assignment_events WHERE assignment_id = ? ORDER BY timestamp ASC", (assignment_id,)).fetchall()
        res = dict(updated_task)
        res["events"] = [dict(e) for e in evs]

    return {
        "assignment": res,
        "message": f"Task assignment successfully updated to '{target_status}'"
    }


@app.get("/api/assignments/{assignment_id}/events")
def get_assignment_events(assignment_id: str):
    with closing(connection()) as db:
        task = db.execute("SELECT * FROM task_assignments WHERE assignment_id = ?", (assignment_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail=f"Task assignment not found: {assignment_id}")
        evs = db.execute("SELECT * FROM assignment_events WHERE assignment_id = ? ORDER BY timestamp ASC", (assignment_id,)).fetchall()
    return {"assignment_id": assignment_id, "events": [dict(e) for e in evs]}


@app.post("/api/teams/seed")
def seed_teams_endpoint():
    with closing(connection()) as db:
        _seed_demo_teams_and_volunteers(db)
        db.commit()
        t_count = db.execute("SELECT COUNT(*) AS c FROM response_teams").fetchone()["c"]
        v_count = db.execute("SELECT COUNT(*) AS c FROM volunteers").fetchone()["c"]
    return {"status": "ok", "teams_seeded": t_count, "volunteers_seeded": v_count}


# ===========================================================================
# Phase 4: Relief Intelligence, Smart Prioritization & Impact Analytics
# ===========================================================================

SCORING_CONFIG = {
    "weights": {
        "severity": 40.0,
        "waiting_time": 20.0,
        "flood_hazard": 15.0,
        "unmet_needs": 15.0,
        "vulnerability": 10.0,
    },
    "severity_points": {
        "CRITICAL": 40.0,
        "HIGH": 28.0,
        "MEDIUM": 16.0,
        "LOW": 6.0,
    },
    "waiting_time_brackets": [
        (24.0, 20.0),
        (12.0, 16.0),
        (6.0, 12.0),
        (2.0, 8.0),
        (0.5, 4.0),
        (0.0, 2.0),
    ],
    "hazard_points": {
        "CRITICAL": 15.0,
        "DANGER": 15.0,
        "WARNING": 10.0,
        "WATCH": 5.0,
        "SAFE": 2.0,
    },
    "essential_category_points": {
        "Rescue": 15.0,
        "Medical": 15.0,
        "Water": 12.0,
        "Food": 12.0,
        "Shelter": 8.0,
    },
    "vulnerability_keywords": [
        "infant", "baby", "toddler", "child", "children",
        "pregnant", "maternity",
        "elderly", "senior", "aged", "geriatric", "grandmother", "grandfather",
        "bedridden", "dialysis", "wheelchair", "disabled", "handicap",
        "oxygen", "paralyzed", "blind"
    ],
    "bands": {
        "Critical": 75.0,
        "High": 55.0,
        "Medium": 35.0,
        "Low": 0.0,
    },
    "stale_hazard_hours": 24.0,
}


def parse_quantity_and_unit(qty_str: str, default_category: str = "") -> tuple[float, str]:
    if not qty_str or not qty_str.strip():
        return 0.0, "unspecified"
    s = qty_str.strip()
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?", s)
    if not m:
        return 0.0, "unspecified"
    val = float(m.group(1))
    unit = (m.group(2) or "units").lower().rstrip("s")
    if unit in ("l", "liter", "litre"):
        unit = "litres"
    elif unit in ("packet", "pkt", "pack", "kit"):
        unit = "packets"
    elif unit in ("can", "bottle"):
        unit = "cans"
    elif unit in ("person", "people"):
        unit = "persons"
    elif unit in ("kg", "kilo"):
        unit = "kg"
    else:
        unit = unit + "s" if not unit.endswith("s") else unit
    return val, unit


def evaluate_priority_for_request(db: sqlite3.Connection, req: dict) -> dict:
    now = datetime.now(timezone.utc)
    explanations = []
    unavailable_inputs = []
    review_reasons = []

    # If fulfilled, operational priority is 0
    if req.get("status") == "Fulfilled":
        return {
            "request_id": req["request_id"],
            "household_label": req.get("household_label", ""),
            "zone_id": req.get("zone_id", ""),
            "category": req.get("category", ""),
            "severity": req.get("severity", "MEDIUM"),
            "verification_status": req.get("verification_status", "Pending Verification"),
            "status": req.get("status", "Fulfilled"),
            "created_at": req.get("created_at", ""),
            "waiting_hours": 0.0,
            "priority_score": 0.0,
            "recommended_band": "Low",
            "effective_band": "Fulfilled",
            "is_overridden": False,
            "override_details": None,
            "score_breakdown": {
                "severity_score": 0.0,
                "waiting_time_score": 0.0,
                "flood_hazard_score": 0.0,
                "unmet_needs_score": 0.0,
                "vulnerability_score": 0.0,
            },
            "explanations": ["Request is fulfilled; active operational priority is 0"],
            "unavailable_inputs": [],
            "latest_hazard_reading": None,
            "needs_human_review": False,
            "review_reasons": [],
        }

    # 1. Severity (up to 40 pts)
    sev = req.get("severity", "MEDIUM")
    sev_pts = SCORING_CONFIG["severity_points"].get(sev, 16.0)
    explanations.append(f"Reported severity is {sev} (+{sev_pts:.0f} pts)")

    # 2. Waiting Time (up to 20 pts)
    waiting_hours = 0.0
    created_at_str = req.get("created_at")
    if created_at_str:
        try:
            created_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            waiting_hours = max(0.0, (now - created_dt).total_seconds() / 3600.0)
        except Exception:
            waiting_hours = 0.0

    wait_pts = 2.0
    for threshold, pts in SCORING_CONFIG["waiting_time_brackets"]:
        if waiting_hours >= threshold:
            wait_pts = pts
            break
    explanations.append(f"Waiting time: {waiting_hours:.1f}h (+{wait_pts:.0f} pts)")

    # 3. Relevant Flood Hazard (up to 15 pts)
    hazard_pts = 0.0
    latest_hazard = None
    zone_id = req.get("zone_id", "")
    reading_row = db.execute(
        """
        SELECT r.water_level_cm, r.observed_at, r.local_status, p.risk_level
        FROM readings r
        LEFT JOIN predictions p ON p.reading_id = r.id
        WHERE r.zone_id = ?
        ORDER BY r.observed_at DESC
        LIMIT 1
        """,
        (zone_id,),
    ).fetchone()

    if reading_row:
        obs_str = reading_row["observed_at"]
        try:
            obs_dt = datetime.fromisoformat(obs_str.replace("Z", "+00:00"))
            hazard_age_hours = max(0.0, (now - obs_dt).total_seconds() / 3600.0)
        except Exception:
            hazard_age_hours = 0.0

        is_stale = hazard_age_hours > SCORING_CONFIG["stale_hazard_hours"]
        risk_lvl = (reading_row["risk_level"] or reading_row["local_status"] or "").upper()
        if not risk_lvl:
            wl = reading_row["water_level_cm"]
            if wl >= 25.0:
                risk_lvl = "CRITICAL"
            elif wl >= 20.0:
                risk_lvl = "DANGER"
            elif wl >= 15.0:
                risk_lvl = "WARNING"
            else:
                risk_lvl = "SAFE"

        latest_hazard = {
            "observed_at": obs_str,
            "water_level_cm": reading_row["water_level_cm"],
            "status": risk_lvl,
            "is_stale": is_stale,
            "age_hours": round(hazard_age_hours, 1),
        }

        if is_stale:
            hazard_pts = 0.0
            explanations.append(
                f"Hazard telemetry in zone {zone_id} is stale ({hazard_age_hours:.1f}h old). Omitted from score per safety rule (+0 pts)"
            )
            review_reasons.append(f"Zone {zone_id} flood telemetry is stale (>24h)")
        else:
            hazard_pts = SCORING_CONFIG["hazard_points"].get(risk_lvl, 2.0)
            explanations.append(
                f"Active flood hazard in zone {zone_id} is {risk_lvl} ({reading_row['water_level_cm']:.1f}cm, +{hazard_pts:.0f} pts)"
            )
    else:
        unavailable_inputs.append("zone_flood_telemetry")
        explanations.append(f"No flood hazard telemetry available for zone {zone_id} (+0 pts)")
        review_reasons.append(f"Missing flood hazard telemetry for zone {zone_id}")

    # 4. Unmet Essential Needs (up to 15 pts)
    alloc_summary = db.execute(
        """
        SELECT 
            COALESCE(SUM(quantity_reserved), 0) AS res,
            COALESCE(SUM(quantity_dispatched), 0) AS disp,
            COALESCE(SUM(quantity_delivered), 0) AS deliv
        FROM allocations
        WHERE request_id = ? AND status != 'Cancelled'
        """,
        (req["request_id"],),
    ).fetchone()

    active_tasks = db.execute(
        """
        SELECT COUNT(*) AS c
        FROM task_assignments
        WHERE request_id = ? AND status IN ('Assigned', 'Accepted', 'En Route', 'Arrived')
        """,
        (req["request_id"],),
    ).fetchone()["c"]

    cat = req.get("category", "")
    base_cat_pts = SCORING_CONFIG["essential_category_points"].get(cat, 8.0)
    delivered_qty = alloc_summary["deliv"] if alloc_summary else 0.0

    if delivered_qty > 0.0:
        unmet_pts = 6.0
        explanations.append(f"Partial relief delivered for category {cat} (+6 pts)")
    elif active_tasks > 0:
        unmet_pts = max(4.0, base_cat_pts - 4.0)
        explanations.append(f"Category {cat} has active team dispatch in progress (+{unmet_pts:.0f} pts)")
    else:
        unmet_pts = base_cat_pts
        explanations.append(f"Unmet essential category {cat} with no active dispatch (+{unmet_pts:.0f} pts)")

    # 5. Explicitly Recorded Household Vulnerability (up to 10 pts)
    # Strictly prohibited from inferring from name, address, or demographic attributes
    text_corpus = f"{req.get('description', '')} {req.get('coordinator_notes', '')}".lower()
    matched_vuln_keywords = [
        kw for kw in SCORING_CONFIG["vulnerability_keywords"] if kw in text_corpus
    ]
    if matched_vuln_keywords:
        vuln_pts = 10.0
        explanations.append(
            f"Explicit vulnerability keyword detected: '{matched_vuln_keywords[0]}' (+10 pts)"
        )
    else:
        vuln_pts = 0.0
        explanations.append(
            "No explicit household vulnerability noted in request text (+0 pts). Safety rule: demographic inferences are strictly prohibited."
        )

    # Calculate total score
    total_score = min(100.0, max(0.0, sev_pts + wait_pts + hazard_pts + unmet_pts + vuln_pts))
    total_score = round(total_score, 1)

    # Determine priority band
    if total_score >= SCORING_CONFIG["bands"]["Critical"]:
        recommended_band = "Critical"
    elif total_score >= SCORING_CONFIG["bands"]["High"]:
        recommended_band = "High"
    elif total_score >= SCORING_CONFIG["bands"]["Medium"]:
        recommended_band = "Medium"
    else:
        recommended_band = "Low"

    # Human review checks
    if req.get("verification_status") == "Pending Verification":
        review_reasons.append("Request is unverified (Pending Verification)")
    if sev == "CRITICAL" and not reading_row:
        review_reasons.append("Critical reported emergency with missing flood telemetry")
    needs_human_review = len(review_reasons) > 0

    # Priority Overrides
    override_row = db.execute(
        """
        SELECT * FROM priority_overrides
        WHERE request_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (req["request_id"],),
    ).fetchone()

    is_overridden = False
    effective_band = recommended_band
    override_details = None
    if override_row:
        is_overridden = True
        effective_band = override_row["overridden_band"]
        override_details = {
            "original_score": override_row["original_score"],
            "original_band": override_row["original_band"],
            "overridden_band": override_row["overridden_band"],
            "reason": override_row["reason"],
            "changed_by": override_row["changed_by"],
            "timestamp": override_row["timestamp"],
        }
        explanations.append(
            f"Coordinator override applied: {override_row['original_band']} -> {override_row['overridden_band']} (Reason: {override_row['reason']})"
        )

    return {
        "request_id": req["request_id"],
        "household_label": req.get("household_label", ""),
        "zone_id": zone_id,
        "category": cat,
        "severity": sev,
        "verification_status": req.get("verification_status", "Pending Verification"),
        "status": req.get("status", "Pending Verification"),
        "created_at": req.get("created_at", ""),
        "waiting_hours": round(waiting_hours, 1),
        "priority_score": total_score,
        "recommended_band": recommended_band,
        "effective_band": effective_band,
        "is_overridden": is_overridden,
        "override_details": override_details,
        "score_breakdown": {
            "severity_score": sev_pts,
            "waiting_time_score": wait_pts,
            "flood_hazard_score": hazard_pts,
            "unmet_needs_score": unmet_pts,
            "vulnerability_score": vuln_pts,
        },
        "explanations": explanations,
        "unavailable_inputs": unavailable_inputs,
        "latest_hazard_reading": latest_hazard,
        "needs_human_review": needs_human_review,
        "review_reasons": review_reasons,
    }


def _seed_demo_intelligence(db: sqlite3.Connection):
    now = datetime.now(timezone.utc)
    # 1. Readings for demo zones:
    # Z001: Critical, fresh
    # Z002: Safe, fresh
    # Z003: Stale reading from 36 hours ago
    readings = [
        ("ESP32-DEMO-Z001", "Z001", 42.0, 112.5, "CRITICAL", (now - timedelta(minutes=15)).isoformat()),
        ("ESP32-DEMO-Z002", "Z002", 6.5, 4.0, "SAFE", (now - timedelta(minutes=20)).isoformat()),
        ("ESP32-DEMO-Z003", "Z003", 38.0, 85.0, "DANGER", (now - timedelta(hours=36)).isoformat()),
    ]
    for did, zid, wl, rain, stat, obs in readings:
        existing = db.execute("SELECT id FROM readings WHERE device_id = ? AND zone_id = ?", (did, zid)).fetchone()
        if not existing:
            db.execute(
                """INSERT INTO readings (device_id, zone_id, water_level_cm, rainfall_24h_mm, local_status, observed_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (did, zid, wl, rain, stat, obs),
            )
            rid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            db.execute(
                """INSERT INTO predictions (reading_id, zone_id, water_trend_cm_per_hour, geo_risk_score, flood_probability, risk_level, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (rid, zid, 4.2 if stat == "CRITICAL" else -0.5, 85 if stat == "CRITICAL" else 20, 0.92 if stat == "CRITICAL" else 0.05, stat, obs),
            )

    # 2. Inventory shortage item for Z004 demo:
    existing_trauma = db.execute("SELECT id FROM inventory_items WHERE item_code = 'MED-TRAUMA-DEMO'").fetchone()
    if not existing_trauma:
        db.execute(
            """INSERT INTO inventory_items (item_code, name, category, unit, storage_location, on_hand, reserved, low_stock_threshold, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("MED-TRAUMA-DEMO", "Emergency Trauma & Hemorrhage Kits", "Medical Supplies", "kits", "Lakadganj Zonal Depot", 0.0, 0.0, 15.0, (now - timedelta(days=2)).isoformat(), now.isoformat()),
        )

    # 3. Demo Emergency Requests:
    demo_int_requests = [
        {
            "request_id": "REQ-DEMO-INT-01",
            "event_id": "SOS-DEMO-INT-01",
            "household_label": "Demo Household #401 - Sitabuldi Market",
            "category": "Rescue",
            "description": "[DEMO] First floor trapped under rising flood water. Elderly grandmother (84yo, wheelchair-bound) needs urgent swiftwater evacuation.",
            "quantity": "4 persons",
            "latitude": 21.1475,
            "longitude": 79.0865,
            "zone_id": "Z001",
            "severity": "CRITICAL",
            "priority_score": 90,
            "source": "simulated_sos",
            "verification_status": "Verified",
            "status": "Verified",
            "rejection_reason": "",
            "coordinator_notes": "Ground verification confirmed by Ward 12. Water at 42cm. Urgent team needed.",
            "created_at": (now - timedelta(hours=8)).isoformat(),
            "updated_at": (now - timedelta(hours=7, minutes=30)).isoformat(),
        },
        {
            "request_id": "REQ-DEMO-INT-02",
            "event_id": None,
            "household_label": "Demo Household #402 - Dharampeth Colony",
            "category": "Water",
            "description": "[DEMO] Silt contamination in tap supply. Need 50L drinking water for family.",
            "quantity": "50 litres",
            "latitude": 21.1390,
            "longitude": 79.0680,
            "zone_id": "Z002",
            "severity": "HIGH",
            "priority_score": 62,
            "source": "web_form",
            "verification_status": "Verified",
            "status": "Assigned",
            "rejection_reason": "",
            "coordinator_notes": "Assigned to Team Charlie for delivery.",
            "created_at": (now - timedelta(hours=3)).isoformat(),
            "updated_at": (now - timedelta(hours=2)).isoformat(),
        },
        {
            "request_id": "REQ-DEMO-INT-03",
            "event_id": None,
            "household_label": "Demo Household #403 - Sitabuldi Canal Road",
            "category": "Food",
            "description": "[DEMO] Family of 6 cut off by canal overflow. Dry ration packets needed.",
            "quantity": "6 packets",
            "latitude": 21.1492,
            "longitude": 79.0840,
            "zone_id": "Z001",
            "severity": "MEDIUM",
            "priority_score": 52,
            "source": "web_form",
            "verification_status": "Pending Verification",
            "status": "Pending Verification",
            "rejection_reason": "",
            "coordinator_notes": "Initial web submission awaiting ward confirmation.",
            "created_at": (now - timedelta(hours=18)).isoformat(),
            "updated_at": (now - timedelta(hours=18)).isoformat(),
        },
        {
            "request_id": "REQ-DEMO-INT-04",
            "event_id": None,
            "household_label": "Demo Household #404 - Wardhaman Nagar",
            "category": "Medical",
            "description": "[DEMO] Diabetic patient running out of insulin, access road waterlogged.",
            "quantity": "2 kits",
            "latitude": 21.1520,
            "longitude": 79.1240,
            "zone_id": "Z003",
            "severity": "CRITICAL",
            "priority_score": 75,
            "source": "web_form",
            "verification_status": "Verified",
            "status": "Verified",
            "rejection_reason": "",
            "coordinator_notes": "Zone Z003 telemetry is stale. Ground contact verified by phone.",
            "created_at": (now - timedelta(hours=1)).isoformat(),
            "updated_at": (now - timedelta(minutes=45)).isoformat(),
        },
        {
            "request_id": "REQ-DEMO-INT-05",
            "event_id": None,
            "household_label": "Demo Household #405 - Reshimbagh Square",
            "category": "Food",
            "description": "[DEMO] Community shelter housing 20 evacuees. Needs 10 meal packets.",
            "quantity": "10 packets",
            "latitude": 21.1290,
            "longitude": 79.1020,
            "zone_id": "Z002",
            "severity": "MEDIUM",
            "priority_score": 50,
            "source": "web_form",
            "verification_status": "Verified",
            "status": "In Progress",
            "rejection_reason": "",
            "coordinator_notes": "Partial batch delivered (5 packets). Remainder en route.",
            "created_at": (now - timedelta(hours=6)).isoformat(),
            "updated_at": (now - timedelta(hours=1)).isoformat(),
        },
        {
            "request_id": "REQ-DEMO-INT-06",
            "event_id": None,
            "household_label": "Demo Household #406 - Lakadganj Timber Market",
            "category": "Medical",
            "description": "[DEMO] Worker sustained severe puncture injury from debris. Emergency trauma kit urgently needed.",
            "quantity": "5 kits",
            "latitude": 21.1550,
            "longitude": 79.1120,
            "zone_id": "Z004",
            "severity": "HIGH",
            "priority_score": 68,
            "source": "web_form",
            "verification_status": "Verified",
            "status": "Verified",
            "rejection_reason": "",
            "coordinator_notes": "Stock shortage in local depot! Local inventory has 0 kits on hand.",
            "created_at": (now - timedelta(hours=4)).isoformat(),
            "updated_at": (now - timedelta(hours=3)).isoformat(),
        },
    ]

    for req in demo_int_requests:
        existing = db.execute("SELECT id FROM emergency_requests WHERE request_id = ?", (req["request_id"],)).fetchone()
        if not existing:
            db.execute(
                """INSERT INTO emergency_requests 
                   (request_id, event_id, household_label, category, description, quantity, latitude, longitude, zone_id, severity, priority_score, source, verification_status, status, rejection_reason, coordinator_notes, is_possible_duplicate, duplicate_notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?)""",
                (
                    req["request_id"], req["event_id"], req["household_label"], req["category"], req["description"],
                    req["quantity"], req["latitude"], req["longitude"], req["zone_id"], req["severity"],
                    req["priority_score"], req["source"], req["verification_status"], req["status"],
                    req["rejection_reason"], req["coordinator_notes"], req["created_at"], req["updated_at"]
                ),
            )
            db.execute(
                """INSERT INTO request_history (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
                   VALUES (?, 'DEMO_SEED', '', ?, 'System Demo Seed', 'Initial Phase 4 synthetic demonstration record', ?)""",
                (req["request_id"], req["status"], req["created_at"]),
            )

    # 4. Partial delivery allocation for REQ-DEMO-INT-05:
    alloc_item = db.execute("SELECT id FROM inventory_items WHERE category = 'Food' LIMIT 1").fetchone()
    if alloc_item:
        item_id = alloc_item["id"]
        existing_alloc = db.execute("SELECT id FROM allocations WHERE request_id = 'REQ-DEMO-INT-05'").fetchone()
        if not existing_alloc:
            alloc_id = "ALLOC-DEMO-INT-05"
            db.execute(
                """INSERT INTO allocations (allocation_id, request_id, inventory_item_id, quantity_reserved, quantity_dispatched, quantity_delivered, status, allocated_by, notes, created_at, updated_at)
                   VALUES (?, 'REQ-DEMO-INT-05', ?, 10.0, 10.0, 5.0, 'Dispatched', 'Demo Coordinator', '5 packets delivered, 5 remaining', ?, ?)""",
                (alloc_id, item_id, (now - timedelta(hours=5)).isoformat(), (now - timedelta(hours=1)).isoformat()),
            )

    # 5. Coordinator override on REQ-DEMO-INT-03:
    existing_ovr = db.execute("SELECT id FROM priority_overrides WHERE request_id = 'REQ-DEMO-INT-03'").fetchone()
    if not existing_ovr:
        db.execute(
            """INSERT INTO priority_overrides (request_id, original_score, original_band, overridden_band, reason, changed_by, timestamp)
               VALUES (?, 52.0, 'Medium', 'Critical', 'Ground scouts report rapidly rising water near canal breaching embankment', 'Lead Coordinator Sharma', ?)""",
            ("REQ-DEMO-INT-03", (now - timedelta(hours=2)).isoformat()),
        )


# ---------------------------------------------------------------------------
# Phase 4 API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/intelligence/overview")
def get_intelligence_overview():
    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        tot_active = db.execute(
            "SELECT COUNT(*) AS c FROM emergency_requests WHERE status NOT IN ('Fulfilled', 'Rejected')"
        ).fetchone()["c"]

        awaiting_verif = db.execute(
            "SELECT COUNT(*) AS c FROM emergency_requests WHERE verification_status = 'Pending Verification'"
        ).fetchone()["c"]

        verif_awaiting_assign = db.execute(
            """
            SELECT COUNT(*) AS c FROM emergency_requests r
            WHERE r.verification_status = 'Verified'
              AND r.status NOT IN ('Fulfilled', 'Rejected')
              AND NOT EXISTS (
                  SELECT 1 FROM task_assignments ta 
                  WHERE ta.request_id = r.request_id 
                    AND ta.status IN ('Assigned', 'Accepted', 'En Route', 'Arrived')
              )
            """
        ).fetchone()["c"]

        crit_unres = db.execute(
            "SELECT COUNT(*) AS c FROM emergency_requests WHERE severity = 'CRITICAL' AND status NOT IN ('Fulfilled', 'Rejected')"
        ).fetchone()["c"]

        act_assign = db.execute(
            "SELECT COUNT(*) AS c FROM task_assignments WHERE status IN ('Assigned', 'Accepted', 'En Route', 'Arrived')"
        ).fetchone()["c"]

        deliv_awaiting = db.execute(
            """
            SELECT COUNT(*) AS c FROM allocations
            WHERE status = 'Dispatched' AND quantity_dispatched > quantity_delivered
            """
        ).fetchone()["c"]

        req_unmet = db.execute(
            "SELECT COUNT(*) AS c FROM emergency_requests WHERE status NOT IN ('Fulfilled', 'Rejected')"
        ).fetchone()["c"]

        low_stock = db.execute(
            "SELECT COUNT(*) AS c FROM inventory_items WHERE on_hand <= low_stock_threshold"
        ).fetchone()["c"]

    return {
        "total_active_requests": tot_active,
        "requests_awaiting_verification": awaiting_verif,
        "verified_awaiting_assignment": verif_awaiting_assign,
        "critical_unresolved": crit_unres,
        "active_assignments": act_assign,
        "deliveries_awaiting_completion": deliv_awaiting,
        "requests_with_unmet_quantities": req_unmet,
        "low_stock_items": low_stock,
        "calculated_at": now,
        "definitions": {
            "total_active_requests": "Requests whose fulfilment status is not Fulfilled or Rejected",
            "requests_awaiting_verification": "Requests with verification status Pending Verification",
            "verified_awaiting_assignment": "Verified requests with no active response team or volunteer task assignment",
            "critical_unresolved": "Requests reported with CRITICAL severity that have not been fulfilled",
            "active_assignments": "Assignments currently in Assigned, Accepted, En Route, or Arrived status",
            "deliveries_awaiting_completion": "Dispatched allocations pending delivered confirmation",
            "requests_with_unmet_quantities": "Active requests awaiting full delivery or rescue",
            "low_stock_items": "Physical inventory items where on-hand quantity is less than or equal to low stock threshold",
        },
    }


@app.get("/api/intelligence/priorities")
def get_intelligence_priorities(
    zone_id: Optional[str] = None,
    severity: Optional[str] = None,
    category: Optional[str] = None,
    band: Optional[str] = None,
    status: Optional[str] = None,
):
    with closing(connection()) as db:
        sql = "SELECT * FROM emergency_requests WHERE 1=1"
        params = []
        if zone_id:
            sql += " AND zone_id = ?"
            params.append(zone_id)
        if severity:
            sql += " AND severity = ?"
            params.append(severity)
        if category:
            sql += " AND category = ?"
            params.append(category)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC"

        req_rows = db.execute(sql, tuple(params)).fetchall()
        evaluations = [evaluate_priority_for_request(db, dict(row)) for row in req_rows]

        if band:
            evaluations = [e for e in evaluations if e["effective_band"].lower() == band.lower()]

        evaluations.sort(key=lambda x: x["priority_score"], reverse=True)

    return evaluations


@app.post("/api/intelligence/requests/{request_id}/override-priority")
def override_request_priority(request_id: str, payload: PriorityOverrideIn):
    band_clean = payload.overridden_band.strip().capitalize()
    if band_clean not in ("Critical", "High", "Medium", "Low"):
        raise HTTPException(status_code=400, detail="Overridden band must be Critical, High, Medium, or Low")

    reason_clean = payload.reason.strip()
    if len(reason_clean) < 3:
        raise HTTPException(status_code=400, detail="Safety rule violation: A specific, non-empty override reason is mandatory")

    now = datetime.now(timezone.utc).isoformat()
    with closing(connection()) as db:
        req_row = db.execute("SELECT * FROM emergency_requests WHERE request_id = ?", (request_id,)).fetchone()
        if not req_row:
            raise HTTPException(status_code=404, detail=f"Emergency request not found: {request_id}")

        current_eval = evaluate_priority_for_request(db, dict(req_row))

        db.execute(
            """INSERT INTO priority_overrides 
               (request_id, original_score, original_band, overridden_band, reason, changed_by, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                request_id,
                current_eval["priority_score"],
                current_eval["recommended_band"],
                band_clean,
                reason_clean,
                payload.changed_by or "Coordinator",
                now,
            ),
        )

        db.execute(
            """INSERT INTO request_history 
               (request_id, action, previous_status, new_status, changed_by, reason, timestamp)
               VALUES (?, 'PRIORITY_OVERRIDE', ?, ?, ?, ?, ?)""",
            (
                request_id,
                req_row["status"],
                req_row["status"],
                payload.changed_by or "Coordinator",
                f"Priority band overridden to {band_clean}: {reason_clean}",
                now,
            ),
        )
        db.commit()

        updated_eval = evaluate_priority_for_request(db, dict(req_row))

    return {
        "status": "ok",
        "message": f"Priority for {request_id} overridden to {band_clean}",
        "evaluation": updated_eval,
    }


@app.get("/api/intelligence/zone-gaps")
def get_intelligence_zone_gaps(
    zone_id: Optional[str] = None,
    category: Optional[str] = None,
    severity: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    now = datetime.now(timezone.utc)
    with closing(connection()) as db:
        zones_in_risks = list(ZONE_RISKS.keys())
        zones_in_reqs = [r["zone_id"] for r in db.execute("SELECT DISTINCT zone_id FROM emergency_requests").fetchall()]
        all_zones = sorted(list(set(zones_in_risks + zones_in_reqs + ["Z001", "Z002", "Z003", "Z004", "Z005"])))

        if zone_id:
            all_zones = [z for z in all_zones if z == zone_id]

        zone_summaries = []
        for zid in all_zones:
            reading_row = db.execute(
                """
                SELECT r.water_level_cm, r.observed_at, r.local_status, p.risk_level
                FROM readings r
                LEFT JOIN predictions p ON p.reading_id = r.id
                WHERE r.zone_id = ?
                ORDER BY r.observed_at DESC
                LIMIT 1
                """,
                (zid,),
            ).fetchone()

            is_stale = False
            hazard_status = "SAFE"
            hazard_age_hours = 0.0
            water_level = 0.0
            hazard_time = None

            if reading_row:
                obs_str = reading_row["observed_at"]
                hazard_time = obs_str
                water_level = reading_row["water_level_cm"]
                try:
                    obs_dt = datetime.fromisoformat(obs_str.replace("Z", "+00:00"))
                    hazard_age_hours = max(0.0, (now - obs_dt).total_seconds() / 3600.0)
                except Exception:
                    hazard_age_hours = 0.0

                is_stale = hazard_age_hours > SCORING_CONFIG["stale_hazard_hours"]
                risk_lvl = (reading_row["risk_level"] or reading_row["local_status"] or "").upper()
                if not risk_lvl:
                    if water_level >= 25.0:
                        risk_lvl = "CRITICAL"
                    elif water_level >= 20.0:
                        risk_lvl = "DANGER"
                    elif water_level >= 15.0:
                        risk_lvl = "WARNING"
                    else:
                        risk_lvl = "SAFE"
                hazard_status = risk_lvl
            else:
                hazard_status = "NO_DATA"

            sql_req = "SELECT * FROM emergency_requests WHERE zone_id = ?"
            params_req = [zid]
            if category:
                sql_req += " AND category = ?"
                params_req.append(category)
            if severity:
                sql_req += " AND severity = ?"
                params_req.append(severity)
            if start_date:
                sql_req += " AND created_at >= ?"
                params_req.append(start_date)
            if end_date:
                sql_req += " AND created_at <= ?"
                params_req.append(end_date)

            reqs = db.execute(sql_req, tuple(params_req)).fetchall()
            known_reqs = len(reqs)
            verified_reqs = sum(1 for r in reqs if r["verification_status"] == "Verified")
            unresolved_reqs = sum(1 for r in reqs if r["status"] not in ("Fulfilled", "Rejected"))

            cat_unit_map: dict[tuple[str, str], dict] = {}
            requests_with_delivery_count = 0

            for r in reqs:
                req_id = r["request_id"]
                rcat = r["category"]
                qty_val, qty_unit = parse_quantity_and_unit(r["quantity"], rcat)

                allocs = db.execute(
                    """
                    SELECT a.*, i.category as item_cat, i.unit as item_unit
                    FROM allocations a
                    JOIN inventory_items i ON i.id = a.inventory_item_id
                    WHERE a.request_id = ? AND a.status != 'Cancelled'
                    """,
                    (req_id,),
                ).fetchall()

                tot_disp = sum(a["quantity_dispatched"] for a in allocs)
                tot_deliv = sum(a["quantity_delivered"] for a in allocs)

                if tot_deliv > 0:
                    requests_with_delivery_count += 1

                if allocs:
                    for a in allocs:
                        key = (a["item_cat"], a["item_unit"])
                        if key not in cat_unit_map:
                            cat_unit_map[key] = {"requested": 0.0, "allocated": 0.0, "dispatched": 0.0, "delivered": 0.0}
                        cat_unit_map[key]["allocated"] += a["quantity_reserved"]
                        cat_unit_map[key]["dispatched"] += a["quantity_dispatched"]
                        cat_unit_map[key]["delivered"] += a["quantity_delivered"]
                else:
                    key = (rcat, qty_unit)
                    if key not in cat_unit_map:
                        cat_unit_map[key] = {"requested": 0.0, "allocated": 0.0, "dispatched": 0.0, "delivered": 0.0}
                    cat_unit_map[key]["requested"] += qty_val

            quantities_list = []
            for (c, u), vals in cat_unit_map.items():
                unmet = max(0.0, vals["requested"] - vals["delivered"])
                quantities_list.append({
                    "category": c,
                    "unit": u,
                    "requested": round(vals["requested"], 1),
                    "allocated": round(vals["allocated"], 1),
                    "dispatched": round(vals["dispatched"], 1),
                    "delivered": round(vals["delivered"], 1),
                    "unmet": round(unmet, 1),
                })

            avail_supplies = db.execute(
                """
                SELECT item_code, name, category, unit, on_hand, storage_location, low_stock_threshold
                FROM inventory_items
                ORDER BY on_hand ASC
                LIMIT 10
                """
            ).fetchall()

            supplies_list = [
                {
                    "item_code": s["item_code"],
                    "name": s["name"],
                    "category": s["category"],
                    "unit": s["unit"],
                    "on_hand": s["on_hand"],
                    "storage_location": s["storage_location"],
                    "is_low_stock": s["on_hand"] <= s["low_stock_threshold"],
                }
                for s in avail_supplies
            ]

            if known_reqs == 0:
                relief_gap_status = "No recorded requests / Insufficient data"
                classification_rule = "Rule: Zero recorded requests. Absence of evidence is not evidence of safety."
            elif unresolved_reqs > 0 and hazard_status in ("CRITICAL", "DANGER"):
                relief_gap_status = "Critical unmet need"
                classification_rule = f"Rule: {unresolved_reqs} unresolved requests under {hazard_status} flood telemetry."
            elif any(q["unmet"] > 0 for q in quantities_list) and any(s["on_hand"] == 0 for s in supplies_list):
                relief_gap_status = "High unmet need (Stock Shortage)"
                classification_rule = "Rule: Outstanding unmet requests coincide with zero stock on critical supplies."
            elif unresolved_reqs > 0:
                relief_gap_status = "Moderate unmet need"
                classification_rule = f"Rule: {unresolved_reqs} requests awaiting complete verification or fulfillment."
            else:
                relief_gap_status = "No currently recorded unmet need"
                classification_rule = "Rule: All recorded requests in this zone have been verified and fulfilled."

            zone_names = {
                "Z001": "Sitabuldi & Nag River Basin",
                "Z002": "Dharampeth & Ambazari Sector",
                "Z003": "Wardhaman Nagar & Pili River",
                "Z004": "Lakadganj Timber Market",
                "Z005": "MIDC Industrial Area - Hingna",
            }
            zname = zone_names.get(zid, f"Nagpur Sector {zid}")

            zone_summaries.append({
                "zone_id": zid,
                "zone_name": zname,
                "flood_hazard_status": hazard_status,
                "water_level_cm": round(water_level, 1),
                "hazard_timestamp": hazard_time,
                "is_hazard_stale": is_stale,
                "hazard_age_hours": round(hazard_age_hours, 1),
                "known_requests_count": known_reqs,
                "verified_requests_count": verified_reqs,
                "unresolved_requests_count": unresolved_reqs,
                "requests_with_delivery_count": requests_with_delivery_count,
                "relief_gap_status": relief_gap_status,
                "classification_rule": classification_rule,
                "quantities": quantities_list,
                "available_supplies": supplies_list,
            })

    return zone_summaries


@app.get("/api/intelligence/recommendations")
def get_intelligence_recommendations():
    now = datetime.now(timezone.utc)
    recs = []

    with closing(connection()) as db:
        unassigned_crits = db.execute(
            """
            SELECT r.* FROM emergency_requests r
            WHERE r.severity = 'CRITICAL' 
              AND r.verification_status = 'Verified'
              AND r.status NOT IN ('Fulfilled', 'Rejected')
              AND NOT EXISTS (
                  SELECT 1 FROM task_assignments ta 
                  WHERE ta.request_id = r.request_id 
                    AND ta.status IN ('Assigned', 'Accepted', 'En Route', 'Arrived')
              )
            """
        ).fetchall()

        for u in unassigned_crits:
            recs.append({
                "id": f"REC-UNASSIGNED-{u['request_id']}",
                "category": "Immediate Dispatch Required",
                "severity": "CRITICAL",
                "title": f"Critical Verified Request Without Response Team ({u['request_id']})",
                "detected_issue": f"Request {u['request_id']} in zone {u['zone_id']} has been verified with CRITICAL severity but has no active response team assigned.",
                "supporting_records": [f"{u['request_id']} (Zone: {u['zone_id']}, Household: {u['household_label']})"],
                "why_it_matters": "Immediate life safety risk. Stranded occupants remain unassisted in active flood hazard zone.",
                "suggested_action": "Assign an available Water Rescue Team or Urban Evacuation Squad from the Volunteers & Teams module.",
            })

        long_wait = db.execute(
            """
            SELECT * FROM emergency_requests
            WHERE status NOT IN ('Fulfilled', 'Rejected')
            """
        ).fetchall()
        for lw in long_wait:
            cstr = lw["created_at"]
            if cstr:
                try:
                    cdt = datetime.fromisoformat(cstr.replace("Z", "+00:00"))
                    hrs = (now - cdt).total_seconds() / 3600.0
                    if hrs >= 12.0:
                        recs.append({
                            "id": f"REC-WAIT-{lw['request_id']}",
                            "category": "Overlooked Request",
                            "severity": "HIGH",
                            "title": f"Extended Waiting Time ({hrs:.1f}h) for Request {lw['request_id']}",
                            "detected_issue": f"Emergency request logged {hrs:.1f} hours ago remains unresolved.",
                            "supporting_records": [f"{lw['request_id']} (Created: {cstr})"],
                            "why_it_matters": "Prolonged response delays can lead to acute medical deterioration or secondary flood trauma.",
                            "suggested_action": "Review triage status, verify household condition, and allocate priority stock or transport.",
                        })
                except Exception:
                    pass

        zero_stocks = db.execute(
            """
            SELECT item_code, name, category, unit, storage_location
            FROM inventory_items
            WHERE on_hand = 0
            """
        ).fetchall()
        for zs in zero_stocks:
            active_cat_reqs = db.execute(
                """
                SELECT COUNT(*) as c FROM emergency_requests
                WHERE category LIKE ? AND status NOT IN ('Fulfilled', 'Rejected')
                """,
                (f"%{zs['category'].split()[0]}%",),
            ).fetchone()["c"]
            if active_cat_reqs > 0:
                recs.append({
                    "id": f"REC-STOCK-{zs['item_code']}",
                    "category": "Supply Depletion",
                    "severity": "HIGH",
                    "title": f"Zero Stock for Essential Supply: {zs['name']}",
                    "detected_issue": f"Depot '{zs['storage_location']}' has 0 {zs['unit']} of {zs['name']} on hand while {active_cat_reqs} active requests exist.",
                    "supporting_records": [f"Item: {zs['item_code']} ({zs['name']}), {active_cat_reqs} active requests"],
                    "why_it_matters": "Outstanding relief requests for this category cannot be fulfilled from current stock.",
                    "suggested_action": "Log an emergency stock receipt or initiate inter-depot rebalancing from central relief hub.",
                })

        stale_dispatches = db.execute(
            """
            SELECT a.*, r.household_label, r.zone_id
            FROM allocations a
            JOIN emergency_requests r ON r.request_id = a.request_id
            WHERE a.status = 'Dispatched' AND a.quantity_dispatched > a.quantity_delivered
            """
        ).fetchall()
        for sd in stale_dispatches:
            udt_str = sd["updated_at"]
            if udt_str:
                try:
                    udt = datetime.fromisoformat(udt_str.replace("Z", "+00:00"))
                    dh = (now - udt).total_seconds() / 3600.0
                    if dh >= 3.0:
                        recs.append({
                            "id": f"REC-DELIV-{sd['allocation_id']}",
                            "category": "Unconfirmed Delivery",
                            "severity": "MEDIUM",
                            "title": f"Dispatched Delivery Pending Confirmation for {dh:.1f}h",
                            "detected_issue": f"Allocation {sd['allocation_id']} was dispatched {dh:.1f}h ago but remains unconfirmed.",
                            "supporting_records": [f"Allocation {sd['allocation_id']} for Request {sd['request_id']}"],
                            "why_it_matters": "May indicate team navigation obstacles, blocked roads, or communication failure.",
                            "suggested_action": "Contact delivery team leader or log delivery confirmation if drop-off was completed.",
                        })
                except Exception:
                    pass

        stale_readings = db.execute(
            """
            SELECT r.zone_id, r.observed_at, r.water_level_cm, r.device_id
            FROM readings r
            WHERE r.id IN (
                SELECT MAX(id) FROM readings GROUP BY zone_id
            )
            """
        ).fetchall()
        for sr in stale_readings:
            try:
                srdt = datetime.fromisoformat(sr["observed_at"].replace("Z", "+00:00"))
                s_age = (now - srdt).total_seconds() / 3600.0
                if s_age > 24.0:
                    recs.append({
                        "id": f"REC-STALE-{sr['zone_id']}",
                        "category": "Stale Hazard Telemetry",
                        "severity": "MEDIUM",
                        "title": f"Flood Telemetry in Zone {sr['zone_id']} is Stale ({s_age:.1f}h old)",
                        "detected_issue": f"Sensor {sr['device_id']} in zone {sr['zone_id']} last transmitted {s_age:.1f} hours ago.",
                        "supporting_records": [f"Device: {sr['device_id']} (Observed: {sr['observed_at']})"],
                        "why_it_matters": "Priority scoring omits stale sensor readings per safety rules to avoid false confidence.",
                        "suggested_action": "Dispatch drone scout or ground reconnaissance team to verify current water levels.",
                    })
            except Exception:
                pass

    return recs


@app.get("/api/intelligence/impact")
def get_intelligence_impact():
    with closing(connection()) as db:
        fulfilled_count = db.execute(
            "SELECT COUNT(*) AS c FROM emergency_requests WHERE status = 'Fulfilled'"
        ).fetchone()["c"]

        partially_fulfilled_count = db.execute(
            """
            SELECT COUNT(DISTINCT r.request_id) AS c
            FROM emergency_requests r
            JOIN allocations a ON a.request_id = r.request_id
            WHERE r.status NOT IN ('Fulfilled', 'Rejected') AND a.quantity_delivered > 0
            """
        ).fetchone()["c"]

        waiting_count = db.execute(
            """
            SELECT COUNT(*) AS c FROM emergency_requests r
            WHERE r.status NOT IN ('Fulfilled', 'Rejected')
              AND NOT EXISTS (
                  SELECT 1 FROM allocations a WHERE a.request_id = r.request_id AND a.quantity_delivered > 0
              )
            """
        ).fetchone()["c"]

        deliv_rows = db.execute(
            """
            SELECT i.category, i.unit, COALESCE(SUM(a.quantity_delivered), 0) AS total_delivered
            FROM allocations a
            JOIN inventory_items i ON i.id = a.inventory_item_id
            WHERE a.quantity_delivered > 0
            GROUP BY i.category, i.unit
            ORDER BY i.category ASC
            """
        ).fetchall()

        delivered_by_category_and_unit = [
            {
                "category": d["category"],
                "unit": d["unit"],
                "quantity": round(d["total_delivered"], 1),
            }
            for d in deliv_rows
        ]

        comp_events = db.execute(
            """
            SELECT r.created_at, h.timestamp as completed_at
            FROM emergency_requests r
            JOIN request_history h ON h.request_id = r.request_id
            WHERE h.new_status = 'Fulfilled' OR h.action = 'COMPLETED'
            """
        ).fetchall()

        response_times_minutes = []
        for ce in comp_events:
            try:
                c_dt = datetime.fromisoformat(ce["created_at"].replace("Z", "+00:00"))
                comp_dt = datetime.fromisoformat(ce["completed_at"].replace("Z", "+00:00"))
                diff_m = max(0.0, (comp_dt - c_dt).total_seconds() / 60.0)
                response_times_minutes.append(diff_m)
            except Exception:
                pass

        if response_times_minutes:
            avg_response_time_minutes = round(sum(response_times_minutes) / len(response_times_minutes), 1)
        else:
            avg_response_time_minutes = None

        disp_total = db.execute(
            "SELECT COALESCE(SUM(quantity_dispatched), 0) AS d, COALESCE(SUM(quantity_delivered), 0) AS v FROM allocations WHERE status != 'Cancelled'"
        ).fetchone()

        if disp_total and disp_total["d"] > 0:
            delivery_completion_rate = round((disp_total["v"] / disp_total["d"]) * 100.0, 1)
            completion_rate_insufficient_data = False
        else:
            delivery_completion_rate = None
            completion_rate_insufficient_data = True

        unmet_zones = db.execute(
            """
            SELECT zone_id, COUNT(*) AS unmet_count
            FROM emergency_requests
            WHERE status NOT IN ('Fulfilled', 'Rejected')
            GROUP BY zone_id
            ORDER BY unmet_count DESC
            """
        ).fetchall()

        unmet_needs_by_zone = [
            {"zone_id": uz["zone_id"], "unmet_count": uz["unmet_count"]}
            for uz in unmet_zones
        ]

    return {
        "requests_fulfilled": fulfilled_count,
        "requests_partially_fulfilled": partially_fulfilled_count,
        "requests_still_waiting": waiting_count,
        "delivered_by_category_and_unit": delivered_by_category_and_unit,
        "average_response_time_minutes": avg_response_time_minutes,
        "response_time_sample_size": len(response_times_minutes),
        "delivery_completion_rate": delivery_completion_rate,
        "completion_rate_insufficient_data": completion_rate_insufficient_data,
        "unmet_needs_by_zone": unmet_needs_by_zone,
    }


@app.get("/api/intelligence/export")
def export_intelligence_csv():
    zone_gaps = get_intelligence_zone_gaps()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    writer.writerow([
        "Zone ID",
        "Zone Name",
        "Flood Hazard Status",
        "Water Level (cm)",
        "Reading Timestamp",
        "Hazard Stale",
        "Known Requests",
        "Verified Requests",
        "Unresolved Requests",
        "Requests With Delivery",
        "Relief Gap Status",
        "Classification Rule",
    ])

    for zg in zone_gaps:
        writer.writerow([
            zg["zone_id"],
            zg["zone_name"],
            zg["flood_hazard_status"],
            zg["water_level_cm"],
            zg["hazard_timestamp"] or "N/A",
            "YES" if zg["is_hazard_stale"] else "NO",
            zg["known_requests_count"],
            zg["verified_requests_count"],
            zg["unresolved_requests_count"],
            zg["requests_with_delivery_count"],
            zg["relief_gap_status"],
            zg["classification_rule"],
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=floodguard_relief_intelligence_report.csv"},
    )


@app.post("/api/intelligence/seed")
def seed_intelligence_demo_endpoint():
    with closing(connection()) as db:
        _seed_demo_intelligence(db)
        db.commit()
        prio_count = db.execute("SELECT COUNT(*) AS c FROM priority_overrides").fetchone()["c"]
        req_count = db.execute("SELECT COUNT(*) AS c FROM emergency_requests").fetchone()["c"]
    return {
        "status": "ok",
        "message": "Phase 4 Relief Intelligence demo records successfully seeded.",
        "emergency_requests_count": req_count,
        "priority_overrides_count": prio_count,
    }


# ---------------------------------------------------------------------------
# Phase 5: Flood-Aware Safe Route Optimization Models & Endpoints
# ---------------------------------------------------------------------------

import routing_service
from routing_service import (
    RoadNetworkGraph,
    RoadNode,
    RoadEdge,
    EvacuationShelter,
    RoutingConfig,
    TravelMode,
    FloodRiskLevel,
    RoadClosureStatus,
    dijkstra_search,
    compare_evacuation_routes,
    evaluate_and_rank_shelters,
    get_active_road_network,
    get_active_shelters,
    reset_demo_road_network,
    update_road_network_from_telemetry,
    update_edge_closure,
)


class TravelModeEnum(str, Enum):
    WALKING = "walking"
    VEHICLE = "vehicle"
    EMERGENCY = "emergency"


class RouteRecommendIn(BaseModel):
    origin_lat: float = Field(ge=-90, le=90)
    origin_lon: float = Field(ge=-180, le=180)
    destination_lat: float | None = Field(default=None, ge=-90, le=90)
    destination_lon: float | None = Field(default=None, ge=-180, le=180)
    shelter_id: str | None = Field(default=None, max_length=50)
    travel_mode: TravelModeEnum = Field(default=TravelModeEnum.WALKING)
    auto_select_best_shelter: bool = Field(default=False)


class RouteCompareIn(BaseModel):
    origin_lat: float = Field(ge=-90, le=90)
    origin_lon: float = Field(ge=-180, le=180)
    destination_lat: float | None = Field(default=None, ge=-90, le=90)
    destination_lon: float | None = Field(default=None, ge=-180, le=180)
    shelter_id: str | None = Field(default=None, max_length=50)
    travel_mode: TravelModeEnum = Field(default=TravelModeEnum.WALKING)
    auto_select_best_shelter: bool = Field(default=False)


class RoadClosureIn(BaseModel):
    edge_id: str = Field(min_length=1, max_length=100)
    closure_status: str = Field(default="Closed", max_length=50)
    reason: str = Field(default="", max_length=300)


class RoutingConfigIn(BaseModel):
    distance_weight: float | None = Field(default=None, ge=0)
    low_risk_factor: float | None = Field(default=None, ge=0)
    moderate_risk_factor: float | None = Field(default=None, ge=0)
    high_risk_factor: float | None = Field(default=None, ge=0)
    critical_risk_factor: float | None = Field(default=None, ge=0)
    exclude_critical: bool | None = None
    unknown_risk_penalty: float | None = Field(default=None, ge=0)
    stale_data_penalty: float | None = Field(default=None, ge=0)
    stale_threshold_hours: float | None = Field(default=None, gt=0)


def _get_latest_readings_map(db: sqlite3.Connection) -> dict[str, dict]:
    rows = db.execute(
        """
        SELECT zone_id, water_level_cm, local_status, observed_at
        FROM readings
        WHERE id IN (
            SELECT MAX(id) FROM readings GROUP BY zone_id
        )
        """
    ).fetchall()
    return {row["zone_id"]: dict(row) for row in rows}


@app.get("/api/routing/health")
def get_routing_health():
    graph = get_active_road_network()
    shelters = get_active_shelters()
    return {
        "status": "ok",
        "service": "FloodGuard Safe Route Optimization Service",
        "version": "1.0.0",
        "road_nodes_count": len(graph.nodes),
        "road_edges_count": len(graph.edges) // 2,
        "shelters_count": len(shelters),
        "network_type": graph.source_name,
        "is_external_osm_enabled": False,
        "modes_supported": ["walking", "vehicle", "emergency"],
        "disclaimer": "Decision-Support Prototype: Not a certified emergency navigation system. Do not evacuate through unverified high-inundation waters."
    }


@app.get("/api/routing/shelters")
def list_evacuation_shelters():
    shelters = get_active_shelters()
    return [
        {
            "shelter_id": s.shelter_id,
            "name": s.name,
            "zone_id": s.zone_id,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "status": s.status,
            "total_capacity": s.total_capacity,
            "current_occupancy": s.current_occupancy,
            "remaining_capacity": (s.total_capacity - s.current_occupancy) if s.total_capacity is not None and s.current_occupancy is not None else None,
            "requires_capacity_review": s.total_capacity is None,
            "contact_number": s.contact_number,
            "address": s.address,
            "facilities": s.facilities,
            "is_synthetic": s.is_synthetic,
            "updated_at": s.updated_at,
        }
        for s in shelters
    ]


@app.get("/api/routing/shelters/ranked")
def get_ranked_shelters(
    origin_lat: float = Query(..., ge=-90, le=90),
    origin_lon: float = Query(..., ge=-180, le=180),
    travel_mode: str = Query("walking")
):
    try:
        t_mode = TravelMode(travel_mode.lower())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid travel mode: {travel_mode}. Supported: walking, vehicle, emergency")

    graph = get_active_road_network()
    shelters = get_active_shelters()
    ranked = evaluate_and_rank_shelters(graph, origin_lat, origin_lon, shelters, t_mode)
    return {
        "origin": {"latitude": origin_lat, "longitude": origin_lon},
        "travel_mode": t_mode.value,
        "ranked_shelters": ranked,
        "total_evaluated": len(ranked),
        "recommended_shelter": ranked[0] if ranked and ranked[0]["is_reachable"] and not ranked[0]["is_closed"] else None
    }


@app.get("/api/routing/road-network/status")
def get_road_network_status():
    graph = get_active_road_network()
    shelters = get_active_shelters()

    features = [edge.to_geojson_feature() for edge in graph.edges.values() if not edge.id.endswith("_rev")]
    node_list = [
        {
            "id": n.id,
            "label": n.label,
            "latitude": n.latitude,
            "longitude": n.longitude,
            "elevation_m": n.elevation_m,
            "zone_id": n.zone_id,
        }
        for n in graph.nodes.values()
    ]

    closed_edges = [
        e for e in graph.edges.values()
        if not e.id.endswith("_rev") and e.closure_status in (RoadClosureStatus.CLOSED, RoadClosureStatus.HAZARD_UNPASSABLE)
    ]
    stale_edges = [e for e in graph.edges.values() if not e.id.endswith("_rev") and e.is_stale]
    unknown_edges = [e for e in graph.edges.values() if not e.id.endswith("_rev") and e.flood_risk_class == FloodRiskLevel.UNKNOWN]

    return {
        "source_name": graph.source_name,
        "total_nodes": len(graph.nodes),
        "total_segments": len(features),
        "closed_segments_count": len(closed_edges),
        "stale_segments_count": len(stale_edges),
        "unknown_risk_segments_count": len(unknown_edges),
        "config": {
            "distance_weight": graph.config.distance_weight,
            "low_risk_factor": graph.config.low_risk_factor,
            "moderate_risk_factor": graph.config.moderate_risk_factor,
            "high_risk_factor": graph.config.high_risk_factor,
            "critical_risk_factor": graph.config.critical_risk_factor,
            "exclude_critical": graph.config.exclude_critical,
            "unknown_risk_penalty": graph.config.unknown_risk_penalty,
            "stale_data_penalty": graph.config.stale_data_penalty,
            "stale_threshold_hours": graph.config.stale_threshold_hours,
            "walking_speed_kmh": graph.config.walking_speed_kmh,
            "vehicle_speed_kmh": graph.config.vehicle_speed_kmh,
            "emergency_speed_kmh": graph.config.emergency_speed_kmh,
            "walking_max_depth_cm": graph.config.walking_max_depth_cm,
            "vehicle_max_depth_cm": graph.config.vehicle_max_depth_cm,
            "emergency_max_depth_cm": graph.config.emergency_max_depth_cm,
        },
        "shelters_count": len(shelters),
        "nodes": node_list,
        "edges_geojson": {
            "type": "FeatureCollection",
            "features": features
        },
        "disclaimer": "Decision-Support Prototype: Simulated demo graph for Nagpur Central. Data is for simulation and planning verification only."
    }


def _resolve_routing_target(
    graph: RoadNetworkGraph,
    shelters: list[EvacuationShelter],
    origin_lat: float,
    origin_lon: float,
    destination_lat: float | None,
    destination_lon: float | None,
    shelter_id: str | None,
    travel_mode: TravelMode,
    auto_select_best: bool
) -> tuple[RoadNode, RoadNode, dict | None]:
    start_node = graph.find_nearest_node(origin_lat, origin_lon)
    if not start_node:
        raise HTTPException(status_code=400, detail="Unable to map origin coordinates to road network.")

    target_node = None
    selected_shelter_meta = None

    if auto_select_best:
        ranked = evaluate_and_rank_shelters(graph, origin_lat, origin_lon, shelters, travel_mode)
        best = next((s for s in ranked if s["is_reachable"] and not s["is_closed"]), None)
        if not best:
            raise HTTPException(status_code=404, detail="No open and reachable evacuation shelter found from current location.")
        target_node = graph.nodes.get(best["node_id"])
        selected_shelter_meta = best
    elif shelter_id:
        shelter = next((s for s in shelters if s.shelter_id == shelter_id), None)
        if not shelter:
            raise HTTPException(status_code=404, detail=f"Evacuation shelter '{shelter_id}' not found.")
        target_node = graph.find_nearest_node(shelter.latitude, shelter.longitude)
        selected_shelter_meta = {
            "shelter_id": shelter.shelter_id,
            "name": shelter.name,
            "status": shelter.status,
            "total_capacity": shelter.total_capacity,
            "requires_capacity_review": shelter.total_capacity is None,
        }
    elif destination_lat is not None and destination_lon is not None:
        target_node = graph.find_nearest_node(destination_lat, destination_lon)
    else:
        # Default to first available shelter
        avail = [s for s in shelters if s.status.lower() == "available"]
        if avail:
            target_node = graph.find_nearest_node(avail[0].latitude, avail[0].longitude)
            selected_shelter_meta = {
                "shelter_id": avail[0].shelter_id,
                "name": avail[0].name,
                "status": avail[0].status,
                "total_capacity": avail[0].total_capacity,
                "requires_capacity_review": avail[0].total_capacity is None,
            }
        else:
            raise HTTPException(status_code=400, detail="Must provide destination coordinates, valid shelter_id, or enable auto_select_best_shelter.")

    if not target_node:
        raise HTTPException(status_code=400, detail="Unable to map destination coordinates to road network.")

    return start_node, target_node, selected_shelter_meta


@app.post("/api/routing/recommend")
def recommend_safe_route_endpoint(payload: RouteRecommendIn):
    graph = get_active_road_network()
    shelters = get_active_shelters()
    t_mode = TravelMode(payload.travel_mode.value)

    start_node, target_node, shelter_meta = _resolve_routing_target(
        graph,
        shelters,
        payload.origin_lat,
        payload.origin_lon,
        payload.destination_lat,
        payload.destination_lon,
        payload.shelter_id,
        t_mode,
        payload.auto_select_best_shelter
    )

    result = dijkstra_search(graph, start_node.id, target_node.id, t_mode, is_flood_aware=True)
    if not result:
        return {
            "status": "NO_ROUTE_FOUND",
            "message": "No sufficiently supported safe route found. All candidate paths either exceed safe water depth thresholds, are blocked by confirmed road closures, or traverse Critical Flood Danger segments.",
            "travel_mode": t_mode.value,
            "start_node": start_node.id,
            "target_node": target_node.id,
            "destination_shelter": shelter_meta,
            "route": None,
            "warnings": [
                "No safe road route found.",
                "Do not attempt unguided evacuation across submerged lowlands.",
                "Contact Nagpur Municipal Disaster Control Room (1077 / 0712-2567014) or request boat rescue."
            ]
        }

    return {
        "status": "ROUTE_CALCULATED",
        "travel_mode": t_mode.value,
        "start_node": start_node.id,
        "target_node": target_node.id,
        "destination_shelter": shelter_meta,
        "route": result,
        "disclaimer": "Decision-Support Prototype: Lowest-cost feasible route based on available road and flood hazard telemetry. Verify visual ground conditions before traversing."
    }


@app.post("/api/routing/compare")
def compare_evacuation_routes_endpoint(payload: RouteCompareIn):
    graph = get_active_road_network()
    shelters = get_active_shelters()
    t_mode = TravelMode(payload.travel_mode.value)

    start_node, target_node, shelter_meta = _resolve_routing_target(
        graph,
        shelters,
        payload.origin_lat,
        payload.origin_lon,
        payload.destination_lat,
        payload.destination_lon,
        payload.shelter_id,
        t_mode,
        payload.auto_select_best_shelter
    )

    comparison = compare_evacuation_routes(graph, start_node.id, target_node.id, t_mode)
    comparison["destination_shelter"] = shelter_meta
    comparison["origin"] = {"latitude": payload.origin_lat, "longitude": payload.origin_lon, "node_id": start_node.id}
    comparison["target"] = {"node_id": target_node.id}
    comparison["disclaimer"] = "Decision-Support Prototype: Lowest-cost feasible route based on available road and hazard data. Not a certified emergency navigation guarantee."
    return comparison


@app.post("/api/routing/closures")
def update_road_closure_endpoint(payload: RoadClosureIn):
    graph = get_active_road_network()
    try:
        status_enum = RoadClosureStatus(payload.closure_status)
    except ValueError:
        # Default to closed if not recognized
        status_enum = RoadClosureStatus.CLOSED if payload.closure_status.lower() == "closed" else RoadClosureStatus.OPEN

    updated = update_edge_closure(graph, payload.edge_id, status_enum, payload.reason)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Road edge '{payload.edge_id}' not found in active graph.")

    return {
        "status": "ok",
        "edge_id": payload.edge_id,
        "closure_status": status_enum.value,
        "reason": payload.reason,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }


@app.post("/api/routing/config")
def update_routing_config_endpoint(payload: RoutingConfigIn):
    graph = get_active_road_network()
    c = graph.config
    if payload.distance_weight is not None:
        c.distance_weight = payload.distance_weight
    if payload.low_risk_factor is not None:
        c.low_risk_factor = payload.low_risk_factor
    if payload.moderate_risk_factor is not None:
        c.moderate_risk_factor = payload.moderate_risk_factor
    if payload.high_risk_factor is not None:
        c.high_risk_factor = payload.high_risk_factor
    if payload.critical_risk_factor is not None:
        c.critical_risk_factor = payload.critical_risk_factor
    if payload.exclude_critical is not None:
        c.exclude_critical = payload.exclude_critical
    if payload.unknown_risk_penalty is not None:
        c.unknown_risk_penalty = payload.unknown_risk_penalty
    if payload.stale_data_penalty is not None:
        c.stale_data_penalty = payload.stale_data_penalty
    if payload.stale_threshold_hours is not None:
        c.stale_threshold_hours = payload.stale_threshold_hours

    return {
        "status": "ok",
        "message": "Routing algorithm cost parameters updated successfully.",
        "config": {
            "distance_weight": c.distance_weight,
            "low_risk_factor": c.low_risk_factor,
            "moderate_risk_factor": c.moderate_risk_factor,
            "high_risk_factor": c.high_risk_factor,
            "critical_risk_factor": c.critical_risk_factor,
            "exclude_critical": c.exclude_critical,
            "unknown_risk_penalty": c.unknown_risk_penalty,
            "stale_data_penalty": c.stale_data_penalty,
            "stale_threshold_hours": c.stale_threshold_hours
        }
    }


@app.post("/api/routing/refresh-hazards")
def refresh_routing_hazards_endpoint():
    graph = get_active_road_network()
    with closing(connection()) as db:
        readings_map = _get_latest_readings_map(db)

    result = update_road_network_from_telemetry(
        graph=graph,
        latest_readings=readings_map,
        zone_risks=ZONE_RISKS,
        stale_hours=graph.config.stale_threshold_hours
    )
    return {
        "status": "ok",
        "message": "Road network flood-hazard telemetry successfully refreshed.",
        "details": result
    }


@app.post("/api/routing/reset-demo")
def reset_routing_demo_endpoint():
    graph, shelters = reset_demo_road_network()
    return {
        "status": "ok",
        "message": "Synthetic demo road network and evacuation shelters reset to default baseline.",
        "total_nodes": len(graph.nodes),
        "total_edges": len(graph.edges) // 2,
        "shelters_count": len(shelters)
    }

