"""Run with `python test_app.py` directly or after starting `uvicorn app:app --port 8000`."""

import csv
import json
from pathlib import Path
from urllib.request import Request, urlopen

try:
    from fastapi.testclient import TestClient
    from app import app
    _client = TestClient(app)
except Exception:
    _client = None


def request(path, payload=None, method="GET"):
    if _client:
        if method == "POST":
            res = _client.post(path, json=payload)
        elif method == "PATCH":
            res = _client.patch(path, json=payload)
        else:
            res = _client.get(path)
        return res.status_code, res.json()

    body = json.dumps(payload).encode() if payload else None
    headers = {"Content-Type": "application/json"} if body else {}
    req = Request(f"http://127.0.0.1:8000{path}", data=body, headers=headers, method=method)
    with urlopen(req, timeout=5) as response:
        return response.status, json.load(response)


status, health = request("/health")
assert status == 200 and health["status"] == "ok" and health["zones_loaded"] == 438
status, zones = request("/api/zones")
assert status == 200 and len(zones) == 438 and any(zone["zone_id"] == "Z001" for zone in zones)
z001_geo_risk = next(zone["geo_risk_score"] for zone in zones if zone["zone_id"] == "Z001")
assert request("/api/readings", {"device_id": "esp32-test", "zone_id": "Z001", "water_level_cm": 40}, method="POST")[0] == 201
status, prediction = request("/api/readings", {"device_id": "esp32-test", "zone_id": "Z001", "water_level_cm": 180, "rainfall_24h_mm": 80}, method="POST")
assert status == 201 and prediction["geo_risk_score"] == z001_geo_risk and prediction["risk_level"] in {"WARNING", "DANGER", "CRITICAL"}
assert request("/api/zones/Z001/latest")[0] == 200

status, prediction = request("/api/readings", {"device_id": "esp32-test", "zone_id": "Z001", "water_level_cm": 25}, method="POST")
assert status == 201 and prediction["risk_level"] in {"DANGER", "CRITICAL"}

spike_levels = [request("/api/readings", {"device_id": "esp32-test", "zone_id": "Z002", "water_level_cm": level}, method="POST")[1]["risk_level"] for level in (8, 8, 8, 8, 8, 13, 8, 8)]
assert all(level == spike_levels[0] for level in spike_levels)

rainfall_csv = Path(__file__).resolve().parent.parent / "viksit/NEW_floodguard_real_evidence_package/historical_rainfall_nagpur.csv"
with rainfall_csv.open(newline="") as file:
    wettest_date = max(csv.DictReader(file), key=lambda row: float(row["rainfall_mm"]))["date"]
status, prediction = request("/api/readings", {"device_id": "esp32-test", "zone_id": "Z003", "water_level_cm": 5, "timestamp": f"{wettest_date}T12:00:00+00:00"}, method="POST")
assert status == 201 and prediction["rainfall_24h_mm"] > 0

# Test Emergency Requests Smoke
status, req_list = request("/api/requests")
assert status == 200 and "items" in req_list and "counts" in req_list
status, sos_sim = request("/api/sos/simulate", {
    "event_id": "SMOKE-SOS-001",
    "household_label": "Smoke Test Household",
    "category": "Water",
    "description": "Smoke test SOS",
    "zone_id": "Z001",
    "severity": "HIGH"
}, method="POST")
assert status in (200, 201) and sos_sim["acknowledged"] is True

print("API smoke test passed")

