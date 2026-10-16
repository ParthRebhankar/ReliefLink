"""
FloodGuard Phase: Flood-Aware Safe Route Optimization Service
Implements a graph-based road network with Dijkstra's algorithm tailored for
evacuation routing that balances distance, flood exposure, closures, and data reliability.
"""

from __future__ import annotations

import heapq
import math
import sqlite3
from contextlib import closing
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Enums and Config Data Models
# ---------------------------------------------------------------------------

class FloodRiskLevel(str, Enum):
    LOW = "Low"
    MODERATE = "Moderate"
    HIGH = "High"
    CRITICAL = "Critical"
    UNKNOWN = "Unknown"


class TravelMode(str, Enum):
    WALKING = "walking"
    VEHICLE = "vehicle"
    EMERGENCY = "emergency"


class RoadClosureStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"
    HAZARD_UNPASSABLE = "Hazard_Unpassable"


@dataclass
class RoutingConfig:
    """Configurable weights and penalties for the flood-aware edge cost function."""
    distance_weight: float = 1.0          # Cost per kilometer
    low_risk_factor: float = 0.5           # Small penalty for low risk
    moderate_risk_factor: float = 5.0      # Noticeable penalty for moderate risk
    high_risk_factor: float = 25.0         # Very large penalty for high risk
    critical_risk_factor: float = 100.0    # Massive penalty or exclusion for critical risk
    exclude_critical: bool = True          # Exclude critical edges when safe alternatives exist
    unknown_risk_penalty: float = 8.0      # Penalty for roads with unknown flood risk
    stale_data_penalty: float = 5.0        # Penalty for hazard data older than 24h
    stale_threshold_hours: float = 24.0    # Data freshness window in hours
    
    # Travel mode speed models (km/h)
    walking_speed_kmh: float = 4.5
    vehicle_speed_kmh: float = 32.0
    emergency_speed_kmh: float = 48.0
    
    # Passability water depth thresholds (cm)
    walking_max_depth_cm: float = 20.0
    vehicle_max_depth_cm: float = 30.0
    emergency_max_depth_cm: float = 45.0


@dataclass
class RoadNode:
    id: str
    label: str
    latitude: float
    longitude: float
    elevation_m: float = 310.0
    zone_id: str = "Z001"


@dataclass
class RoadEdge:
    id: str
    name: str
    u: str
    v: str
    length_m: float
    road_type: str = "secondary"
    speed_limit_kmh: float = 40.0
    travel_modes: List[str] = field(default_factory=lambda: ["walking", "vehicle", "emergency"])
    geometry: List[List[float]] = field(default_factory=list)  # [[lon, lat], ...]
    zone_id: str = "Z001"
    
    # Risk & Hazard Data
    flood_risk_class: FloodRiskLevel = FloodRiskLevel.LOW
    flood_risk_score: Optional[float] = 15.0  # 0 to 100
    water_depth_cm: Optional[float] = None
    is_stale: bool = False
    data_source: str = "Zone Baseline"
    data_timestamp: str = ""
    
    # Closure Status
    closure_status: RoadClosureStatus = RoadClosureStatus.OPEN
    closure_reason: str = ""
    
    def to_geojson_feature(self) -> Dict[str, Any]:
        return {
            "type": "Feature",
            "properties": {
                "edge_id": self.id,
                "name": self.name,
                "u": self.u,
                "v": self.v,
                "length_m": round(self.length_m, 1),
                "road_type": self.road_type,
                "flood_risk_class": self.flood_risk_class.value,
                "flood_risk_score": self.flood_risk_score,
                "water_depth_cm": self.water_depth_cm,
                "is_stale": self.is_stale,
                "data_source": self.data_source,
                "data_timestamp": self.data_timestamp,
                "closure_status": self.closure_status.value,
                "closure_reason": self.closure_reason,
                "zone_id": self.zone_id,
            },
            "geometry": {
                "type": "LineString",
                "coordinates": self.geometry
            }
        }


@dataclass
class EvacuationShelter:
    shelter_id: str
    name: str
    zone_id: str
    latitude: float
    longitude: float
    status: str = "Available"           # Available, Full, Closed
    total_capacity: Optional[int] = 300  # Nullable if unknown
    current_occupancy: Optional[int] = 60
    contact_number: str = "+91-712-2560000"
    address: str = "Nagpur Central"
    facilities: str = "Medical Aid, Clean Water, Bedding, Power Generator"
    is_synthetic: bool = True
    updated_at: str = ""


# ---------------------------------------------------------------------------
# Haversine Distance Helper
# ---------------------------------------------------------------------------

def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# ---------------------------------------------------------------------------
# Road Graph Container
# ---------------------------------------------------------------------------

class RoadNetworkGraph:
    def __init__(self, source_name: str = "synthetic_demo"):
        self.source_name: str = source_name
        self.nodes: Dict[str, RoadNode] = {}
        self.edges: Dict[str, RoadEdge] = {}
        self.adjacency: Dict[str, List[Tuple[str, str]]] = {}  # u -> list of (v, edge_id)
        self.config: RoutingConfig = RoutingConfig()
        self.created_at: str = datetime.now(timezone.utc).isoformat()

    def add_node(self, node: RoadNode):
        self.nodes[node.id] = node
        if node.id not in self.adjacency:
            self.adjacency[node.id] = []

    def add_edge(self, edge: RoadEdge, bidirectional: bool = True):
        self.edges[edge.id] = edge
        if edge.u not in self.adjacency:
            self.adjacency[edge.u] = []
        self.adjacency[edge.u].append((edge.v, edge.id))
        
        if bidirectional:
            # Reverse edge has same properties but flipped u, v and inverted geometry
            rev_id = f"{edge.id}_rev"
            rev_edge = RoadEdge(
                id=rev_id,
                name=edge.name,
                u=edge.v,
                v=edge.u,
                length_m=edge.length_m,
                road_type=edge.road_type,
                speed_limit_kmh=edge.speed_limit_kmh,
                travel_modes=edge.travel_modes,
                geometry=list(reversed(edge.geometry)) if edge.geometry else [],
                zone_id=edge.zone_id,
                flood_risk_class=edge.flood_risk_class,
                flood_risk_score=edge.flood_risk_score,
                water_depth_cm=edge.water_depth_cm,
                is_stale=edge.is_stale,
                data_source=edge.data_source,
                data_timestamp=edge.data_timestamp,
                closure_status=edge.closure_status,
                closure_reason=edge.closure_reason
            )
            self.edges[rev_id] = rev_edge
            if edge.v not in self.adjacency:
                self.adjacency[edge.v] = []
            self.adjacency[edge.v].append((edge.u, rev_id))

    def find_nearest_node(self, lat: float, lon: float) -> Optional[RoadNode]:
        if not self.nodes:
            return None
        nearest_node = None
        min_dist = float("inf")
        for node in self.nodes.values():
            d = haversine_distance_m(lat, lon, node.latitude, node.longitude)
            if d < min_dist:
                min_dist = d
                nearest_node = node
        return nearest_node

    def calculate_edge_cost(
        self,
        edge: RoadEdge,
        travel_mode: TravelMode,
        is_flood_aware: bool = True
    ) -> Tuple[float, Optional[str]]:
        """
        Calculates the traversal cost of an edge.
        Returns (cost, exclusion_reason). If excluded, cost is infinity.
        """
        # Mode capability check
        if travel_mode.value not in edge.travel_modes:
            return float("inf"), f"Road type '{edge.road_type}' incompatible with {travel_mode.value}"

        # Closure checks
        if edge.closure_status in (RoadClosureStatus.CLOSED, RoadClosureStatus.HAZARD_UNPASSABLE):
            return float("inf"), f"Road closed: {edge.closure_reason or 'Confirmed impassable'}"

        # Passability water depth check by travel mode
        if edge.water_depth_cm is not None:
            max_depth = (
                self.config.walking_max_depth_cm if travel_mode == TravelMode.WALKING else
                self.config.vehicle_max_depth_cm if travel_mode == TravelMode.VEHICLE else
                self.config.emergency_max_depth_cm
            )
            if edge.water_depth_cm > max_depth:
                return float("inf"), f"Water depth {edge.water_depth_cm}cm exceeds {travel_mode.value} threshold ({max_depth}cm)"

        distance_km = edge.length_m / 1000.0

        if not is_flood_aware:
            # Ordinary shortest distance routing only minimizes distance
            return distance_km * self.config.distance_weight, None

        # -------------------------------------------------------------------
        # Flood-Aware Cost Calculation
        # edge_cost = distance_cost + flood_risk_penalty + uncertainty_penalty
        # -------------------------------------------------------------------
        distance_cost = distance_km * self.config.distance_weight
        flood_risk_penalty = 0.0
        uncertainty_penalty = 0.0

        if edge.flood_risk_class == FloodRiskLevel.LOW:
            score = edge.flood_risk_score if edge.flood_risk_score is not None else 20.0
            flood_risk_penalty = (score / 100.0) * self.config.low_risk_factor
        elif edge.flood_risk_class == FloodRiskLevel.MODERATE:
            score = edge.flood_risk_score if edge.flood_risk_score is not None else 50.0
            flood_risk_penalty = (score / 100.0) * self.config.moderate_risk_factor
        elif edge.flood_risk_class == FloodRiskLevel.HIGH:
            score = edge.flood_risk_score if edge.flood_risk_score is not None else 75.0
            flood_risk_penalty = (score / 100.0) * self.config.high_risk_factor
        elif edge.flood_risk_class == FloodRiskLevel.CRITICAL:
            if self.config.exclude_critical:
                return float("inf"), "Critical flood danger on segment (safety policy excludes critical hazards)"
            score = edge.flood_risk_score if edge.flood_risk_score is not None else 95.0
            flood_risk_penalty = (score / 100.0) * self.config.critical_risk_factor
        elif edge.flood_risk_class == FloodRiskLevel.UNKNOWN:
            # Explicitly distinguish unknown risk from low risk
            uncertainty_penalty += self.config.unknown_risk_penalty

        if edge.is_stale:
            uncertainty_penalty += self.config.stale_data_penalty

        total_cost = distance_cost + flood_risk_penalty + uncertainty_penalty
        return total_cost, None


# ---------------------------------------------------------------------------
# Dijkstra Routing Engine
# ---------------------------------------------------------------------------

def dijkstra_search(
    graph: RoadNetworkGraph,
    start_node_id: str,
    target_node_id: str,
    travel_mode: TravelMode = TravelMode.WALKING,
    is_flood_aware: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Executes Dijkstra's algorithm from start_node_id to target_node_id.
    Returns path metadata, ordered nodes, edges, geometry, and cost diagnostics.
    """
    if start_node_id not in graph.nodes or target_node_id not in graph.nodes:
        return None

    # Priority queue: (accumulated_cost, current_node_id)
    pq: List[Tuple[float, str]] = [(0.0, start_node_id)]
    distances: Dict[str, float] = {start_node_id: 0.0}
    predecessors: Dict[str, Tuple[Optional[str], Optional[str]]] = {start_node_id: (None, None)}  # node -> (prev_node, edge_id)

    visited: Set[str] = set()

    while pq:
        curr_dist, curr_node = heapq.heappop(pq)

        if curr_node in visited:
            continue
        visited.add(curr_node)

        if curr_node == target_node_id:
            break

        for neighbor_node, edge_id in graph.adjacency.get(curr_node, []):
            if neighbor_node in visited:
                continue

            edge = graph.edges[edge_id]
            edge_cost, exclusion = graph.calculate_edge_cost(edge, travel_mode, is_flood_aware=is_flood_aware)
            if math.isinf(edge_cost):
                continue

            new_dist = curr_dist + edge_cost
            if new_dist < distances.get(neighbor_node, float("inf")):
                distances[neighbor_node] = new_dist
                predecessors[neighbor_node] = (curr_node, edge_id)
                heapq.heappush(pq, (new_dist, neighbor_node))

    if target_node_id not in predecessors:
        return None  # Disconnected or no feasible route

    # Reconstruct path
    path_nodes: List[str] = []
    path_edges: List[RoadEdge] = []
    curr = target_node_id

    while curr is not None:
        path_nodes.append(curr)
        prev_node, edge_id = predecessors.get(curr, (None, None))
        if edge_id:
            path_edges.append(graph.edges[edge_id])
        curr = prev_node

    path_nodes.reverse()
    path_edges.reverse()

    # Aggregate road metrics
    total_length_m = sum(e.length_m for e in path_edges)
    total_cost = distances[target_node_id]

    # Full road geometry by joining coordinates
    full_coordinates: List[List[float]] = []
    for e in path_edges:
        if e.geometry:
            for pt in e.geometry:
                if not full_coordinates or full_coordinates[-1] != pt:
                    full_coordinates.append(pt)
        else:
            # Fallback to node coordinates
            u_node = graph.nodes[e.u]
            v_node = graph.nodes[e.v]
            if not full_coordinates:
                full_coordinates.append([u_node.longitude, u_node.latitude])
            full_coordinates.append([v_node.longitude, v_node.latitude])

    # Speed & Travel Time
    speed_kmh = (
        graph.config.walking_speed_kmh if travel_mode == TravelMode.WALKING else
        graph.config.vehicle_speed_kmh if travel_mode == TravelMode.VEHICLE else
        graph.config.emergency_speed_kmh
    )
    travel_time_min = round((total_length_m / 1000.0 / speed_kmh) * 60.0, 1)

    # Risk metrics
    risk_rank = {
        FloodRiskLevel.LOW: 1,
        FloodRiskLevel.UNKNOWN: 2,
        FloodRiskLevel.MODERATE: 3,
        FloodRiskLevel.HIGH: 4,
        FloodRiskLevel.CRITICAL: 5
    }
    max_risk_level = FloodRiskLevel.LOW
    unknown_count = 0
    stale_count = 0
    high_critical_count = 0

    for e in path_edges:
        if risk_rank[e.flood_risk_class] > risk_rank[max_risk_level]:
            max_risk_level = e.flood_risk_class
        if e.flood_risk_class == FloodRiskLevel.UNKNOWN:
            unknown_count += 1
        if e.is_stale:
            stale_count += 1
        if e.flood_risk_class in (FloodRiskLevel.HIGH, FloodRiskLevel.CRITICAL):
            high_critical_count += 1

    return {
        "is_flood_aware": is_flood_aware,
        "travel_mode": travel_mode.value,
        "start_node": start_node_id,
        "target_node": target_node_id,
        "total_cost": round(total_cost, 2),
        "total_distance_km": round(total_length_m / 1000.0, 2),
        "total_distance_m": round(total_length_m, 1),
        "estimated_travel_time_minutes": travel_time_min,
        "segment_count": len(path_edges),
        "max_risk_level": max_risk_level.value,
        "high_critical_segment_count": high_critical_count,
        "unknown_risk_segment_count": unknown_count,
        "unknown_risk_percentage": round((unknown_count / max(1, len(path_edges))) * 100.0, 1),
        "stale_segment_count": stale_count,
        "stale_percentage": round((stale_count / max(1, len(path_edges))) * 100.0, 1),
        "node_ids": path_nodes,
        "edge_ids": [e.id for e in path_edges],
        "segments": [
            {
                "edge_id": e.id,
                "name": e.name,
                "length_m": round(e.length_m, 1),
                "road_type": e.road_type,
                "flood_risk_class": e.flood_risk_class.value,
                "flood_risk_score": e.flood_risk_score,
                "water_depth_cm": e.water_depth_cm,
                "is_stale": e.is_stale,
                "data_source": e.data_source,
                "data_timestamp": e.data_timestamp,
                "closure_status": e.closure_status.value,
                "zone_id": e.zone_id,
                "start_node": e.u,
                "end_node": e.v,
                "coordinates": e.geometry
            }
            for e in path_edges
        ],
        "geometry": {
            "type": "LineString",
            "coordinates": full_coordinates
        }
    }


# ---------------------------------------------------------------------------
# Route Comparison & Explanation Engine
# ---------------------------------------------------------------------------

def compare_evacuation_routes(
    graph: RoadNetworkGraph,
    start_node_id: str,
    target_node_id: str,
    travel_mode: TravelMode = TravelMode.WALKING
) -> Dict[str, Any]:
    """
    Computes both the Ordinary Shortest Route and the Flood-Aware Recommended Route,
    contrasting distance, flood exposure, closures avoided, and safety tradeoffs.
    """
    # 1. Ordinary Shortest Route
    shortest_res = dijkstra_search(graph, start_node_id, target_node_id, travel_mode, is_flood_aware=False)

    # 2. Flood-Aware Recommended Route
    flood_res = dijkstra_search(graph, start_node_id, target_node_id, travel_mode, is_flood_aware=True)

    if not flood_res and not shortest_res:
        return {
            "status": "NO_ROUTE_FOUND",
            "message": "No connected or passable route exists between the selected origin and destination.",
            "recommended_route": None,
            "shortest_route": None,
            "explanation": "Every candidate path is either disconnected, blocked by confirmed road closures, or exceeds safe water depth limits for the selected travel mode.",
            "warnings": [
                "No safe road route found.",
                "Do not attempt unguided evacuation through inundated lowlands.",
                "Contact Nagpur Municipal Disaster Cell (1077 / 0712-2567014) or await rescue boat."
            ]
        }

    # Count known closures in the network
    network_closures = [
        e for e in graph.edges.values()
        if e.closure_status in (RoadClosureStatus.CLOSED, RoadClosureStatus.HAZARD_UNPASSABLE)
    ]
    
    # Check if routes are identical
    are_identical = False
    if shortest_res and flood_res:
        are_identical = (shortest_res["edge_ids"] == flood_res["edge_ids"])

    # Build explanation
    explanation_parts = []
    warnings = [
        "Decision-Support Prototype: Road flood exposure is based on sensor telemetry and zone terrain models. Conditions can evolve rapidly during heavy rainfall.",
        "Always follow instructions from on-ground emergency wardens and NDRF personnel."
    ]

    if not flood_res and shortest_res:
        explanation_parts.append(
            "A standard road path exists, but it traverses Critical Flood Danger segments that violate evacuation safety thresholds."
        )
        warnings.append("Caution: Ordinary shortest path crosses hazardous flooded roads. No verified safe route found.")
    elif flood_res and not shortest_res:
        explanation_parts.append(
            "The direct road path is physically blocked by confirmed closures, but an alternative safe evacuation route was successfully found."
        )
    elif are_identical:
        explanation_parts.append(
            "The ordinary shortest path is already the safest available route with minimal flood risk."
        )
    else:
        dist_diff_km = round(flood_res["total_distance_km"] - shortest_res["total_distance_km"], 2)
        shortest_max_risk = shortest_res["max_risk_level"]
        flood_max_risk = flood_res["max_risk_level"]
        
        explanation_parts.append(
            f"The flood-aware route takes a safer alternative path (distance {flood_res['total_distance_km']} km vs {shortest_res['total_distance_km']} km). "
            f"While {abs(dist_diff_km)} km {'longer' if dist_diff_km > 0 else 'shorter'}, it reduces peak flood hazard from {shortest_max_risk} down to {flood_max_risk} "
            f"and avoids {shortest_res['high_critical_segment_count']} high/critical inundation hazard segments."
        )

    if flood_res and flood_res["unknown_risk_segment_count"] > 0:
        warnings.append(
            f"Uncertainty Notice: {flood_res['unknown_risk_segment_count']} road segment(s) along the recommended route have unmonitored flood risk. Exercise visual caution."
        )

    if flood_res and flood_res["stale_segment_count"] > 0:
        warnings.append(
            f"Stale Sensor Notice: {flood_res['stale_segment_count']} segment(s) rely on sensor data older than {graph.config.stale_threshold_hours}h."
        )

    return {
        "status": "ROUTE_CALCULATED",
        "are_routes_identical": are_identical,
        "travel_mode": travel_mode.value,
        "recommended_route": flood_res,
        "shortest_route": shortest_res,
        "network_closures_count": len(network_closures) // 2,  # account for bidirectional edges
        "explanation": " ".join(explanation_parts),
        "warnings": warnings,
        "evaluated_at": datetime.now(timezone.utc).isoformat()
    }


# ---------------------------------------------------------------------------
# Multi-Shelter Evaluation & Ranking
# ---------------------------------------------------------------------------

def evaluate_and_rank_shelters(
    graph: RoadNetworkGraph,
    origin_lat: float,
    origin_lon: float,
    shelters: List[EvacuationShelter],
    travel_mode: TravelMode = TravelMode.WALKING
) -> List[Dict[str, Any]]:
    """
    Evaluates candidate shelters based on:
    1. Availability status (open vs closed/full)
    2. Road network reachability from origin
    3. Flood-aware evacuation cost
    4. Distance and estimated travel time
    5. Capacity review requirement (flag missing capacity rather than assuming it's available)
    """
    origin_node = graph.find_nearest_node(origin_lat, origin_lon)
    if not origin_node:
        return []

    ranked_candidates = []

    for shelter in shelters:
        # Check basic status
        is_closed = shelter.status.lower() in ("closed", "unsafe")
        is_full = shelter.status.lower() == "full"
        has_unknown_capacity = shelter.total_capacity is None

        shelter_node = graph.find_nearest_node(shelter.latitude, shelter.longitude)
        if not shelter_node:
            continue

        route_res = None
        is_reachable = False
        flood_cost = float("inf")
        distance_km = None
        travel_time_min = None

        if not is_closed:
            route_res = dijkstra_search(graph, origin_node.id, shelter_node.id, travel_mode, is_flood_aware=True)
            if route_res:
                is_reachable = True
                flood_cost = route_res["total_cost"]
                distance_km = route_res["total_distance_km"]
                travel_time_min = route_res["estimated_travel_time_minutes"]

        # Capacity occupancy
        remaining_capacity = None
        if shelter.total_capacity is not None and shelter.current_occupancy is not None:
            remaining_capacity = max(0, shelter.total_capacity - shelter.current_occupancy)

        ranked_candidates.append({
            "shelter_id": shelter.shelter_id,
            "name": shelter.name,
            "zone_id": shelter.zone_id,
            "latitude": shelter.latitude,
            "longitude": shelter.longitude,
            "status": shelter.status,
            "total_capacity": shelter.total_capacity,
            "current_occupancy": shelter.current_occupancy,
            "remaining_capacity": remaining_capacity,
            "requires_capacity_review": has_unknown_capacity or is_full,
            "is_reachable": is_reachable,
            "is_closed": is_closed,
            "flood_aware_cost": flood_cost if not math.isinf(flood_cost) else None,
            "route_distance_km": distance_km,
            "estimated_travel_time_minutes": travel_time_min,
            "max_risk_level": route_res["max_risk_level"] if route_res else None,
            "facilities": shelter.facilities,
            "contact_number": shelter.contact_number,
            "route_geometry": route_res["geometry"] if route_res else None,
            "node_id": shelter_node.id
        })

    # Sort ranking:
    # 1. Reachable & open shelters first
    # 2. Lowest flood-aware route cost
    # 3. Shortest distance
    def sort_key(c):
        if c["is_closed"] or not c["is_reachable"] or c["flood_aware_cost"] is None:
            return (2, 999999, 999999)
        return (0 if not c["requires_capacity_review"] else 1, c["flood_aware_cost"], c["route_distance_km"] or 999999)

    ranked_candidates.sort(key=sort_key)
    return ranked_candidates


# ---------------------------------------------------------------------------
# Synthetic Nagpur Demo Road Network Builder
# ---------------------------------------------------------------------------

def build_nagpur_demo_network() -> Tuple[RoadNetworkGraph, List[EvacuationShelter]]:
    """
    Constructs a deterministic, clearly labelled synthetic road graph for Nagpur demo.
    Features:
    - Origin N1 in Zone Z001 (Sitabuldi Lowland flood zone)
    - Shorter route via Canal Road that has high/critical flood risk
    - Closed segment on Bridge Underpass (Cotton Market Crossing)
    - Longer alternative route via West Ridge / Ramdaspeth with Low risk
    - Road segment with Unknown flood risk (Canal Crossway)
    - Two shelters:
      * Shelter A: Sitabuldi Higher Secondary Relief Shelter (Large, available)
      * Shelter B: Dharampeth Hill Relief Camp (High ground, alternative)
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    stale_iso = "2026-10-15T00:00:00Z"  # Older than 24h

    graph = RoadNetworkGraph(source_name="synthetic_demo")

    # Nodes (Sitabuldi / Central Nagpur coordinates)
    nodes = [
        RoadNode("N1", "Sitabuldi Lowland Junction (Origin Z001)", 21.1420, 79.0830, elevation_m=298.0, zone_id="Z001"),
        RoadNode("N2", "Central Canal Bridge Approach", 21.1410, 79.0875, elevation_m=299.5, zone_id="Z001"),
        RoadNode("N3", "Railway Station Road Crossing", 21.1395, 79.0920, elevation_m=301.0, zone_id="Z001"),
        RoadNode("N4", "Cotton Market Subway (Inundation Zone)", 21.1360, 79.0950, elevation_m=296.0, zone_id="Z001"),
        RoadNode("N5", "East Central Link", 21.1320, 79.0930, elevation_m=304.0, zone_id="Z002"),
        RoadNode("N6", "Sitabuldi Elevated Ridge (High Ground)", 21.1380, 79.0805, elevation_m=318.0, zone_id="Z001"),
        RoadNode("N7", "Ramdaspeth West Avenue", 21.1330, 79.0780, elevation_m=315.0, zone_id="Z003"),
        RoadNode("N8", "Dhantoli High Ground Bypass", 21.1290, 79.0840, elevation_m=312.0, zone_id="Z003"),
        RoadNode("N9", "Canal Crossway Unmonitored", 21.1350, 79.0870, elevation_m=303.0, zone_id="Z001"),
        RoadNode("N10", "Shelter A Approach (Wardha Road)", 21.1260, 79.0860, elevation_m=310.0, zone_id="Z003"),
        RoadNode("N11", "West Hill Crest", 21.1360, 79.0730, elevation_m=325.0, zone_id="Z004"),
        RoadNode("N12", "Shelter B Approach (Dharampeth Hill)", 21.1390, 79.0680, elevation_m=330.0, zone_id="Z004"),
    ]

    for n in nodes:
        graph.add_node(n)

    # -----------------------------------------------------------------------
    # Edges & Realistic Curved Road Geometry
    # -----------------------------------------------------------------------
    # Helper to generate smooth curved path between two points
    def interpolate_curve(lon1, lat1, lon2, lat2, curve_bias_lon=0.0005, curve_bias_lat=-0.0003):
        mid_lon = (lon1 + lon2) / 2.0 + curve_bias_lon
        mid_lat = (lat1 + lat2) / 2.0 + curve_bias_lat
        return [
            [round(lon1, 6), round(lat1, 6)],
            [round((lon1 + mid_lon) / 2.0, 6), round((lat1 + mid_lat) / 2.0, 6)],
            [round(mid_lon, 6), round(mid_lat, 6)],
            [round((mid_lon + lon2) / 2.0, 6), round((mid_lat + lat2) / 2.0, 6)],
            [round(lon2, 6), round(lat2, 6)],
        ]

    # Edge 1: N1 -> N2 (Along open canal, HIGH flood risk 18cm water depth)
    graph.add_edge(RoadEdge(
        id="E_canal_drain",
        name="Central Drain Canal Service Road (Simulation - Flooded)",
        u="N1",
        v="N2",
        length_m=520.0,
        road_type="secondary",
        flood_risk_class=FloodRiskLevel.HIGH,
        flood_risk_score=75.0,
        water_depth_cm=18.0,
        is_stale=False,
        data_source="ESP32 IoT Sensor 01 (Live Telemetry)",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        closure_reason="",
        zone_id="Z001",
        geometry=interpolate_curve(79.0830, 21.1420, 79.0875, 21.1410, 0.0004, -0.0002)
    ))

    # Edge 2: N2 -> N3 (Station approach, HIGH flood risk)
    graph.add_edge(RoadEdge(
        id="E_station_road",
        name="Station Approach Road (Simulation)",
        u="N2",
        v="N3",
        length_m=580.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.HIGH,
        flood_risk_score=72.0,
        water_depth_cm=26.0,
        is_stale=False,
        data_source="Municipal Drainage Monitor",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z001",
        geometry=interpolate_curve(79.0875, 21.1410, 79.0920, 21.1395, 0.0003, -0.0004)
    ))

    # Edge 3: N3 -> N4 (CONFIRMED CLOSED SUBWAY)
    graph.add_edge(RoadEdge(
        id="E_subway_closed",
        name="Cotton Market Rail Subway (Simulation)",
        u="N3",
        v="N4",
        length_m=460.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.CRITICAL,
        flood_risk_score=98.0,
        water_depth_cm=58.0,
        is_stale=False,
        data_source="Traffic Police Flood Alert",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.CLOSED,
        closure_reason="Underpass completely submerged under 58cm storm runoff",
        zone_id="Z001",
        geometry=interpolate_curve(79.0920, 21.1395, 79.0950, 21.1360, 0.0005, -0.0003)
    ))

    # Edge 4: N4 -> N5
    graph.add_edge(RoadEdge(
        id="E_east_link",
        name="East Industrial Link (Simulation)",
        u="N4",
        v="N5",
        length_m=510.0,
        road_type="secondary",
        flood_risk_class=FloodRiskLevel.MODERATE,
        flood_risk_score=48.0,
        water_depth_cm=14.0,
        is_stale=False,
        data_source="Zone Z002 Baseline Model",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z002",
        geometry=interpolate_curve(79.0950, 21.1360, 79.0930, 21.1320, -0.0003, -0.0002)
    ))

    # Edge 5: N5 -> N10 (To Shelter A)
    graph.add_edge(RoadEdge(
        id="E_shelterA_east",
        name="Wardha Road East Link (Simulation)",
        u="N5",
        v="N10",
        length_m=890.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=18.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Field Volunteer Scouting",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z003",
        geometry=interpolate_curve(79.0930, 21.1320, 79.0860, 21.1260, -0.0004, -0.0005)
    ))

    # Edge 6: N2 -> N9 (UNMONITORED / UNKNOWN RISK SEGMENT)
    graph.add_edge(RoadEdge(
        id="E_canal_crossway_unknown",
        name="Canal Crossway Lane (Simulation - Unknown Risk)",
        u="N2",
        v="N9",
        length_m=680.0,
        road_type="residential",
        flood_risk_class=FloodRiskLevel.UNKNOWN,
        flood_risk_score=None,
        water_depth_cm=None,
        is_stale=False,
        data_source="Unmonitored Ward Lane",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z001",
        geometry=interpolate_curve(79.0875, 21.1410, 79.0870, 21.1350, -0.0002, -0.0003)
    ))

    # Edge 7: N9 -> N8 (STALE DATA SEGMENT)
    graph.add_edge(RoadEdge(
        id="E_crossway_dhantoli_stale",
        name="Old Cotton Mill Alley (Simulation - Stale Telemetry)",
        u="N9",
        v="N8",
        length_m=740.0,
        road_type="residential",
        flood_risk_class=FloodRiskLevel.MODERATE,
        flood_risk_score=35.0,
        water_depth_cm=8.0,
        is_stale=True,  # > 24h old
        data_source="Historic Sensor S-09 (Offline >36h)",
        data_timestamp=stale_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z003",
        geometry=interpolate_curve(79.0870, 21.1350, 79.0840, 21.1290, -0.0004, -0.0003)
    ))

    # -----------------------------------------------------------------------
    # Safe High-Ground Evacuation Path (West Ridge -> Ramdaspeth -> Dhantoli -> Shelter A)
    # -----------------------------------------------------------------------
    # Edge 8: N1 -> N6 (West uphill toward Sitabuldi Ridge)
    graph.add_edge(RoadEdge(
        id="E_west_ridge_climb",
        name="Sitabuldi Fort Ridge Ascent (Simulation)",
        u="N1",
        v="N6",
        length_m=640.0,
        road_type="secondary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=12.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Elevated Ridge Gauge",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z001",
        geometry=interpolate_curve(79.0830, 21.1420, 79.0805, 21.1380, -0.0004, -0.0002)
    ))

    # Edge 9: N6 -> N7 (Ramdaspeth West Avenue, safe high elevation)
    graph.add_edge(RoadEdge(
        id="E_ramdaspeth_avenue",
        name="Ramdaspeth West Arterial (Simulation)",
        u="N6",
        v="N7",
        length_m=680.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=14.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Zone Z003 Geo-Risk Model",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z003",
        geometry=interpolate_curve(79.0805, 21.1380, 79.0780, 21.1330, -0.0003, -0.0004)
    ))

    # Edge 10: N7 -> N8 (Ramdaspeth to Dhantoli high ground)
    graph.add_edge(RoadEdge(
        id="E_dhantoli_highground",
        name="Dhantoli Elevated Boulevard (Simulation)",
        u="N7",
        v="N8",
        length_m=790.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=16.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="District Administration Report",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z003",
        geometry=interpolate_curve(79.0780, 21.1330, 79.0840, 21.1290, 0.0004, -0.0003)
    ))

    # Edge 11: N8 -> N10 (Dhantoli to Shelter A direct approach)
    graph.add_edge(RoadEdge(
        id="E_shelterA_approach",
        name="Wardha Road High Ground Approach (Simulation)",
        u="N8",
        v="N10",
        length_m=420.0,
        road_type="primary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=10.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Shelter Coordinator Report",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z003",
        geometry=interpolate_curve(79.0840, 21.1290, 79.0860, 21.1260, 0.0003, -0.0002)
    ))

    # -----------------------------------------------------------------------
    # Alternative Path to Shelter B (Dharampeth Hill)
    # -----------------------------------------------------------------------
    # Edge 12: N6 -> N11 (West Hill Crest)
    graph.add_edge(RoadEdge(
        id="E_west_crest",
        name="Civil Lines Hill Crest (Simulation)",
        u="N6",
        v="N11",
        length_m=860.0,
        road_type="secondary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=8.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Civil Lines Baseline",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z004",
        geometry=interpolate_curve(79.0805, 21.1380, 79.0730, 21.1360, -0.0005, -0.0001)
    ))

    # Edge 13: N11 -> N12 (To Shelter B)
    graph.add_edge(RoadEdge(
        id="E_shelterB_approach",
        name="Dharampeth Hill Ascent (Simulation)",
        u="N11",
        v="N12",
        length_m=640.0,
        road_type="secondary",
        flood_risk_class=FloodRiskLevel.LOW,
        flood_risk_score=5.0,
        water_depth_cm=0.0,
        is_stale=False,
        data_source="Dharampeth High Point",
        data_timestamp=now_iso,
        closure_status=RoadClosureStatus.OPEN,
        zone_id="Z004",
        geometry=interpolate_curve(79.0730, 21.1360, 79.0680, 21.1390, -0.0004, 0.0002)
    ))

    # -----------------------------------------------------------------------
    # Shelters
    # -----------------------------------------------------------------------
    shelters = [
        EvacuationShelter(
            shelter_id="SHELTER-001",
            name="Sitabuldi Higher Secondary Relief Shelter (Simulation)",
            zone_id="Z003",
            latitude=21.1260,
            longitude=79.0860,
            status="Available",
            total_capacity=450,
            current_occupancy=110,
            contact_number="+91-712-2561101",
            address="Wardha Road near Congress Nagar, Nagpur",
            facilities="Medical Bay, Drinking Water Station, 24/7 Power, Food Rations",
            is_synthetic=True,
            updated_at=now_iso
        ),
        EvacuationShelter(
            shelter_id="SHELTER-002",
            name="Dharampeth Hill Community Relief Camp (Simulation)",
            zone_id="Z004",
            latitude=21.1390,
            longitude=79.0680,
            status="Available",
            total_capacity=300,
            current_occupancy=45,
            contact_number="+91-712-2562202",
            address="West High Court Road, Dharampeth, Nagpur",
            facilities="High Ground Shelter, Water Purification, Emergency Bedding",
            is_synthetic=True,
            updated_at=now_iso
        ),
        EvacuationShelter(
            shelter_id="SHELTER-003",
            name="Dhantoli Municipal Primary School (Simulation - Review Needed)",
            zone_id="Z003",
            latitude=21.1310,
            longitude=79.0880,
            status="Available",
            total_capacity=None,  # Missing capacity to test review rule
            current_occupancy=None,
            contact_number="+91-712-2563303",
            address="Dhantoli Ward 12, Nagpur",
            facilities="Basic Shelter Hall, Backup Generator",
            is_synthetic=True,
            updated_at=now_iso
        ),
        EvacuationShelter(
            shelter_id="SHELTER-004",
            name="Cotton Market Community Hall (Simulation - Inundated/Closed)",
            zone_id="Z001",
            latitude=21.1355,
            longitude=79.0965,
            status="Closed",  # Confirmed closed to test exclusion
            total_capacity=200,
            current_occupancy=0,
            contact_number="+91-712-2564404",
            address="Near Cotton Market Square, Nagpur",
            facilities="None - Compound Submerged",
            is_synthetic=True,
            updated_at=now_iso
        ),
    ]

    return graph, shelters


def update_road_network_from_telemetry(
    graph: RoadNetworkGraph,
    latest_readings: Dict[str, Dict[str, Any]],
    zone_risks: Dict[str, Dict[str, Any]],
    stale_hours: float = 24.0
) -> Dict[str, Any]:
    """
    Associates authoritative FloodGuard sensor readings and zone risk scores
    with road segments across the graph.
    """
    updated_edges = 0
    now = datetime.now(timezone.utc)

    for edge in graph.edges.values():
        zid = edge.zone_id
        reading = latest_readings.get(zid)

        if reading:
            # We have direct telemetry in this zone
            obs_raw = reading.get("observed_at") or reading.get("timestamp")
            is_stale = False
            obs_dt = None
            if obs_raw:
                try:
                    obs_clean = str(obs_raw).replace("Z", "+00:00")
                    obs_dt = datetime.fromisoformat(obs_clean)
                    if obs_dt.tzinfo is None:
                        obs_dt = obs_dt.replace(tzinfo=timezone.utc)
                    if (now - obs_dt).total_seconds() > stale_hours * 3600.0:
                        is_stale = True
                except Exception:
                    is_stale = True

            edge.is_stale = is_stale
            edge.data_timestamp = str(obs_raw) if obs_raw else now.isoformat()
            edge.data_source = f"FloodGuard Sensor Telemetry ({zid})"
            
            water_level = reading.get("water_level_cm")
            if water_level is not None:
                edge.water_depth_cm = float(water_level)
                
            status_val = (reading.get("local_status") or reading.get("risk_level") or "").upper()
            if status_val == "CRITICAL" or (water_level is not None and water_level >= 40.0):
                edge.flood_risk_class = FloodRiskLevel.CRITICAL
                edge.flood_risk_score = 95.0
            elif status_val == "DANGER" or (water_level is not None and water_level >= 25.0):
                edge.flood_risk_class = FloodRiskLevel.HIGH
                edge.flood_risk_score = 75.0
            elif status_val == "WARNING" or (water_level is not None and water_level >= 15.0):
                edge.flood_risk_class = FloodRiskLevel.MODERATE
                edge.flood_risk_score = 50.0
            else:
                edge.flood_risk_class = FloodRiskLevel.LOW
                edge.flood_risk_score = 20.0
            updated_edges += 1

        elif zid in zone_risks:
            # Fallback to zone geo-risk baseline model without inventing water depth
            zdata = zone_risks[zid]
            score = float(zdata.get("risk_score", 20.0))
            edge.flood_risk_score = score
            edge.water_depth_cm = None  # Do not invent water depth when only zone risk is known
            edge.is_stale = False
            edge.data_source = f"Zone {zid} Geo-Risk Model"
            edge.data_timestamp = now.isoformat()
            
            if score >= 76.0:
                edge.flood_risk_class = FloodRiskLevel.CRITICAL
            elif score >= 56.0:
                edge.flood_risk_class = FloodRiskLevel.HIGH
            elif score >= 31.0:
                edge.flood_risk_class = FloodRiskLevel.MODERATE
            else:
                edge.flood_risk_class = FloodRiskLevel.LOW
            updated_edges += 1

    return {
        "updated_edges": updated_edges,
        "total_edges": len(graph.edges),
        "telemetry_zones_found": len(latest_readings),
        "updated_at": now.isoformat()
    }


def update_edge_closure(
    graph: RoadNetworkGraph,
    edge_id: str,
    closure_status: RoadClosureStatus,
    reason: str = ""
) -> bool:
    """Updates closure status for an edge and its bidirectional counterpart."""
    found = False
    target_ids = [edge_id, f"{edge_id}_rev"] if not edge_id.endswith("_rev") else [edge_id, edge_id[:-4]]
    for eid in target_ids:
        if eid in graph.edges:
            edge = graph.edges[eid]
            edge.closure_status = closure_status
            edge.closure_reason = reason
            found = True
    return found


# Global singleton instance for memory cache
_GLOBAL_GRAPH: Optional[RoadNetworkGraph] = None
_GLOBAL_SHELTERS: List[EvacuationShelter] = []


def get_active_road_network() -> RoadNetworkGraph:
    global _GLOBAL_GRAPH, _GLOBAL_SHELTERS
    if _GLOBAL_GRAPH is None:
        _GLOBAL_GRAPH, _GLOBAL_SHELTERS = build_nagpur_demo_network()
    return _GLOBAL_GRAPH


def get_active_shelters() -> List[EvacuationShelter]:
    global _GLOBAL_GRAPH, _GLOBAL_SHELTERS
    if not _GLOBAL_SHELTERS:
        _GLOBAL_GRAPH, _GLOBAL_SHELTERS = build_nagpur_demo_network()
    return _GLOBAL_SHELTERS


def reset_demo_road_network() -> Tuple[RoadNetworkGraph, List[EvacuationShelter]]:
    global _GLOBAL_GRAPH, _GLOBAL_SHELTERS
    _GLOBAL_GRAPH, _GLOBAL_SHELTERS = build_nagpur_demo_network()
    return _GLOBAL_GRAPH, _GLOBAL_SHELTERS

