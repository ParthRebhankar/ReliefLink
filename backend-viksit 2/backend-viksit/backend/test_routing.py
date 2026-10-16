"""
Comprehensive Unit Tests for FloodGuard Phase:
Flood-Aware Safe Route Optimization Service & Dijkstra Navigation Engine.
"""

import math
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import sys
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import app as app_module
from fastapi.testclient import TestClient

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
    build_nagpur_demo_network,
    update_road_network_from_telemetry,
    update_edge_closure,
)


class TestSafeRouteOptimization(unittest.TestCase):

    def setUp(self):
        # Build fresh isolated graph for each test
        self.graph, self.shelters = build_nagpur_demo_network()
        self.client = TestClient(app_module.app)

    # 1. Ordinary shortest path calculation
    def test_ordinary_shortest_path_minimizes_physical_distance(self):
        res = dijkstra_search(self.graph, "N1", "N10", travel_mode=TravelMode.WALKING, is_flood_aware=False)
        self.assertIsNotNone(res)
        self.assertFalse(res["is_flood_aware"])
        # Should choose the shorter physical route through canal/crossway (2.36 km)
        self.assertAlmostEqual(res["total_distance_km"], 2.36, places=1)
        self.assertEqual(res["max_risk_level"], FloodRiskLevel.HIGH.value)

    # 2. Flood-aware path chooses longer, safer route
    def test_flood_aware_path_chooses_safer_longer_route(self):
        shortest = dijkstra_search(self.graph, "N1", "N10", travel_mode=TravelMode.WALKING, is_flood_aware=False)
        flood_aware = dijkstra_search(self.graph, "N1", "N10", travel_mode=TravelMode.WALKING, is_flood_aware=True)

        self.assertIsNotNone(shortest)
        self.assertIsNotNone(flood_aware)
        self.assertTrue(flood_aware["is_flood_aware"])

        # Flood-aware route is longer in distance (2.53 km > 2.36 km)
        self.assertGreater(flood_aware["total_distance_km"], shortest["total_distance_km"])
        # But has lower risk (LOW vs HIGH)
        self.assertEqual(flood_aware["max_risk_level"], FloodRiskLevel.LOW.value)
        self.assertEqual(shortest["max_risk_level"], FloodRiskLevel.HIGH.value)
        # Avoids high/critical segments
        self.assertEqual(flood_aware["high_critical_segment_count"], 0)
        self.assertGreaterEqual(shortest["high_critical_segment_count"], 1)

    # 3. Confirmed closed road avoidance
    def test_confirmed_closed_road_is_strictly_excluded(self):
        # E_subway_closed (N3 -> N4) is closed
        res_flood = dijkstra_search(self.graph, "N3", "N4", travel_mode=TravelMode.WALKING, is_flood_aware=True)
        res_short = dijkstra_search(self.graph, "N3", "N4", travel_mode=TravelMode.WALKING, is_flood_aware=False)
        # Both must avoid traversing a confirmed closed road directly
        self.assertIsNone(res_flood)
        self.assertIsNone(res_short)

    # 4. Disconnected graph handling
    def test_disconnected_graph_returns_none(self):
        # Add an isolated island node with no edges
        island = RoadNode("ISLAND_99", "Isolated Ward", 21.1500, 79.1000)
        self.graph.add_node(island)

        res = dijkstra_search(self.graph, "N1", "ISLAND_99", travel_mode=TravelMode.WALKING, is_flood_aware=True)
        self.assertIsNone(res)

    # 5. Unknown flood risk data has distinct penalty and warning
    def test_unknown_risk_distinguished_and_penalized(self):
        # E_canal_crossway_unknown connects N2 to N9 with UNKNOWN risk
        edge = self.graph.edges["E_canal_crossway_unknown"]
        self.assertEqual(edge.flood_risk_class, FloodRiskLevel.UNKNOWN)

        cost_known_low = self.graph.calculate_edge_cost(self.graph.edges["E_shelterA_approach"], TravelMode.WALKING, is_flood_aware=True)[0]
        cost_unknown = self.graph.calculate_edge_cost(edge, TravelMode.WALKING, is_flood_aware=True)[0]

        # Unknown penalty should make edge cost significantly higher than clean low risk
        self.assertGreater(cost_unknown, cost_known_low)

    # 6. Stale sensor data penalty
    def test_stale_data_penalty_applied(self):
        # E_crossway_dhantoli_stale has is_stale = True
        stale_edge = self.graph.edges["E_crossway_dhantoli_stale"]
        self.assertTrue(stale_edge.is_stale)

        cost_stale = self.graph.calculate_edge_cost(stale_edge, TravelMode.WALKING, is_flood_aware=True)[0]
        # Temporarily mark fresh
        stale_edge.is_stale = False
        cost_fresh = self.graph.calculate_edge_cost(stale_edge, TravelMode.WALKING, is_flood_aware=True)[0]
        stale_edge.is_stale = True

        self.assertGreater(cost_stale, cost_fresh)

    # 7. Passability water depth limits by travel mode
    def test_passability_depth_thresholds_by_mode(self):
        # Create test edge with 25cm water depth
        test_edge = RoadEdge(
            id="E_TEST_DEPTH",
            name="Inundated Test Avenue",
            u="N1",
            v="N2",
            length_m=500.0,
            water_depth_cm=25.0,  # Exceeds walking (20cm) but within vehicle (30cm) and emergency (45cm)
            closure_status=RoadClosureStatus.OPEN,
            travel_modes=["walking", "vehicle", "emergency"]
        )

        cost_walk, reason_walk = self.graph.calculate_edge_cost(test_edge, TravelMode.WALKING, is_flood_aware=True)
        cost_veh, reason_veh = self.graph.calculate_edge_cost(test_edge, TravelMode.VEHICLE, is_flood_aware=True)

        self.assertTrue(math.isinf(cost_walk))
        self.assertIn("exceeds walking threshold", reason_walk)
        self.assertFalse(math.isinf(cost_veh))

    # 8. Shelter evaluation & ranking
    def test_shelter_ranking_and_capacity_review(self):
        ranked = evaluate_and_rank_shelters(self.graph, 21.1420, 79.0830, self.shelters, TravelMode.WALKING)
        self.assertGreaterEqual(len(ranked), 2)

        # Shelter A (Sitabuldi) should be reachable and top ranked
        top = ranked[0]
        self.assertEqual(top["shelter_id"], "SHELTER-001")
        self.assertTrue(top["is_reachable"])
        self.assertFalse(top["requires_capacity_review"])

        # Shelter with missing capacity should be flagged requires_capacity_review
        s3 = next(s for s in ranked if s["shelter_id"] == "SHELTER-003")
        self.assertTrue(s3["requires_capacity_review"])

        # Closed shelter should not be recommended
        s4 = next(s for s in ranked if s["shelter_id"] == "SHELTER-004")
        self.assertTrue(s4["is_closed"])

    # 9. Route comparison structure and explanation
    def test_route_comparison_engine(self):
        comp = compare_evacuation_routes(self.graph, "N1", "N10", TravelMode.WALKING)
        self.assertEqual(comp["status"], "ROUTE_CALCULATED")
        self.assertFalse(comp["are_routes_identical"])
        self.assertIn("safer alternative path", comp["explanation"])
        self.assertIsNotNone(comp["recommended_route"])
        self.assertIsNotNone(comp["shortest_route"])

    # 10. Route geometry ordering and valid coordinates
    def test_route_geometry_ordering(self):
        res = dijkstra_search(self.graph, "N1", "N10", TravelMode.WALKING, is_flood_aware=True)
        coords = res["geometry"]["coordinates"]
        self.assertGreater(len(coords), 4)
        # First coordinate should be at or near N1 (79.0830, 21.1420)
        first_pt = coords[0]
        self.assertAlmostEqual(first_pt[0], 79.0830, places=3)
        self.assertAlmostEqual(first_pt[1], 21.1420, places=3)
        # Last coordinate should be at or near N10 (79.0860, 21.1260)
        last_pt = coords[-1]
        self.assertAlmostEqual(last_pt[0], 79.0860, places=3)
        self.assertAlmostEqual(last_pt[1], 21.1260, places=3)

    # 11. Configurable risk weights
    def test_configurable_weights_affect_cost(self):
        orig_weight = self.graph.config.distance_weight
        self.graph.config.distance_weight = 10.0
        cost_high_dist = self.graph.calculate_edge_cost(self.graph.edges["E_west_ridge_climb"], TravelMode.WALKING, is_flood_aware=True)[0]
        self.graph.config.distance_weight = 1.0
        cost_normal = self.graph.calculate_edge_cost(self.graph.edges["E_west_ridge_climb"], TravelMode.WALKING, is_flood_aware=True)[0]
        self.graph.config.distance_weight = orig_weight

        self.assertGreater(cost_high_dist, cost_normal)

    # 12. Dynamic telemetry association
    def test_telemetry_association_updates_edges(self):
        fake_telemetry = {
            "Z001": {
                "water_level_cm": 42.0,
                "local_status": "CRITICAL",
                "observed_at": datetime.now(timezone.utc).isoformat()
            }
        }
        res = update_road_network_from_telemetry(self.graph, fake_telemetry, {})
        self.assertGreater(res["updated_edges"], 0)
        # Segments in Z001 should now have critical flood risk
        z001_edge = self.graph.edges["E_canal_drain"]
        self.assertEqual(z001_edge.flood_risk_class, FloodRiskLevel.CRITICAL)
        self.assertEqual(z001_edge.water_depth_cm, 42.0)

    # 13. API endpoint integration tests
    def test_api_routing_health(self):
        resp = self.client.get("/api/routing/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertGreater(data["road_nodes_count"], 5)
        self.assertGreater(data["shelters_count"], 0)

    def test_api_routing_shelters(self):
        resp = self.client.get("/api/routing/shelters")
        self.assertEqual(resp.status_code, 200)
        shelters = resp.json()
        self.assertIsInstance(shelters, list)
        self.assertGreaterEqual(len(shelters), 2)

    def test_api_routing_compare(self):
        payload = {
            "origin_lat": 21.1420,
            "origin_lon": 79.0830,
            "shelter_id": "SHELTER-001",
            "travel_mode": "walking"
        }
        resp = self.client.post("/api/routing/compare", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ROUTE_CALCULATED")
        self.assertIn("recommended_route", data)
        self.assertIn("shortest_route", data)

    def test_api_routing_invalid_coordinates(self):
        payload = {
            "origin_lat": 999.0,  # Invalid latitude
            "origin_lon": 79.0830,
            "shelter_id": "SHELTER-001",
            "travel_mode": "walking"
        }
        resp = self.client.post("/api/routing/recommend", json=payload)
        self.assertEqual(resp.status_code, 422)  # Pydantic validation error

    # 14. Verification that pre-existing endpoints remain functional
    def test_existing_endpoints_unaffected(self):
        health_resp = self.client.get("/health")
        self.assertEqual(health_resp.status_code, 200)
        self.assertEqual(health_resp.json()["status"], "ok")

        zones_resp = self.client.get("/api/zones")
        self.assertEqual(zones_resp.status_code, 200)
        self.assertGreater(len(zones_resp.json()), 0)


if __name__ == "__main__":
    unittest.main()
