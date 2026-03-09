"""
Geometry processing: DXF LWPOLYLINE parsing, building perimeter, obstacles.

Uses ezdxf to read DXF and extract:
- Building perimeter (closed LWPOLYLINE with largest area, or first closed)
- Obstacles: other closed polylines (property line, interior), circles (pillars), lines
  used for Buragetto clearance checks.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import ezdxf
from ezdxf.document import Drawing
from ezdxf.entities import LWPolyline
from ezdxf.layouts import Modelspace


# ─── Constants (mm) ─────────────────────────────────────────────────────
PATTANKO_GAP_MM = 200

# DXF $INSUNITS: 4=mm, 5=cm, 6=m (and 0=unitless, 1=in, 2=ft, etc.)
DETECTED_UNIT_MM = "mm"
DETECTED_UNIT_CM = "cm"
DETECTED_UNIT_M = "m"
DetectedUnit = str  # "mm" | "cm" | "m"

# Layer name substrings (case-insensitive) for balcony / AC area detection
OBSTACLE_LAYER_BALCONY = ("BALCONY", "BALCONIES", "VERANDA", "ベランダ", "バルコニー", "BLCN")
OBSTACLE_LAYER_AC = ("AC", "AC_UNIT", "室外機", "エアコン", "AIRCON", "MEP_AC", "AC_UNITS")
OBSTACLE_TYPE_BALCONY = "balcony"
OBSTACLE_TYPE_AC = "ac"
"""Gap between platform edge and wall for Pattanko flaps (both Double-Post and Bracket)."""


@dataclass
class Point2D:
    x: float
    y: float

    def distance_to(self, other: "Point2D") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)


@dataclass
class Segment2D:
    """Line segment from A to B."""
    start: Point2D
    end: Point2D

    def length(self) -> float:
        return self.start.distance_to(self.end)

    def direction_vector(self) -> Tuple[float, float]:
        L = self.length()
        if L <= 0:
            return (1.0, 0.0)
        return ((self.end.x - self.start.x) / L, (self.end.y - self.start.y) / L)

    def inward_normal(self, building_inside: bool = True) -> Tuple[float, float]:
        """Unit normal pointing inward (toward building interior) or outward."""
        dx = self.end.x - self.start.x
        dy = self.end.y - self.start.y
        # Perpendicular: (-dy, dx) is "left" of direction, (dy, -dx) is "right"
        nx = -dy
        ny = dx
        L = math.hypot(nx, ny) or 1.0
        nx, ny = nx / L, ny / L
        # Assume CCW perimeter: inward = left of direction. If building is CW, flip.
        if not building_inside:
            nx, ny = -nx, -ny
        return (nx, ny)

    def point_at(self, t: float) -> Point2D:
        return Point2D(
            self.start.x + t * (self.end.x - self.start.x),
            self.start.y + t * (self.end.y - self.start.y),
        )


@dataclass
class BuildingEdge:
    """One edge of the building perimeter (one side: North, South, etc.)."""
    index: int
    label: str  # e.g. "North", "South", "East", "West", or "edge-0", "edge-1"
    segment: Segment2D
    length_mm: float


def _polygon_area_2d(vertices: List[Point2D]) -> float:
    """Signed area (CCW = positive)."""
    n = len(vertices)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y
    return area / 2.0


def _is_ccw(vertices: List[Point2D]) -> bool:
    return _polygon_area_2d(vertices) > 0


def _obstacle_type_from_layer(layer: str) -> Optional[str]:
    """Return 'balcony' or 'ac' if layer name matches known patterns; else None."""
    raw = layer or ""
    u = raw.upper()
    for pat in OBSTACLE_LAYER_BALCONY:
        if pat.upper() in u or (len(pat) > 1 and pat in raw):
            return OBSTACLE_TYPE_BALCONY
    for pat in OBSTACLE_LAYER_AC:
        if pat.upper() in u or (len(pat) > 1 and pat in raw):
            return OBSTACLE_TYPE_AC
    return None


@dataclass
class ObstacleRegion:
    """Labeled obstacle area (balcony or AC) for reporting; also included in ObstacleSet for clearance."""
    type: str  # 'balcony' | 'ac'
    segments: List[Segment2D] = field(default_factory=list)
    circles: List[Tuple[Point2D, float]] = field(default_factory=list)


@dataclass
class ObstacleSet:
    """Obstacles for clearance check: segments and circles (pillars, balconies, AC areas)."""
    segments: List[Segment2D] = field(default_factory=list)
    circles: List[Tuple[Point2D, float]] = field(default_factory=list)  # (center, radius_mm)
    regions: List[ObstacleRegion] = field(default_factory=list)  # labeled balcony / AC for reporting

    def min_distance_to_segment(self, seg: Segment2D) -> float:
        """Minimum distance from any obstacle to the given segment (wall)."""
        best = float("inf")
        for s in self.segments:
            d = _segment_to_segment_distance(seg, s)
            if d < best:
                best = d
        for center, r in self.circles:
            d = _circle_to_segment_distance(center, r, seg)
            if d < best:
                best = d
        return best if best != float("inf") else 999999.0


def _segment_to_segment_distance(a: Segment2D, b: Segment2D) -> float:
    """Min distance between two segments (approximate: segment mid to segment)."""
    # Simple: distance from b's midpoint to segment a (wall), then subtract nothing for segment b length
    # Better: point-to-segment for each endpoint and closest point.
    mid_b = b.point_at(0.5)
    return _point_to_segment_distance(mid_b, a)


def _point_to_segment_distance(p: Point2D, seg: Segment2D) -> float:
    """Distance from point p to segment seg."""
    dx = seg.end.x - seg.start.x
    dy = seg.end.y - seg.start.y
    L2 = dx * dx + dy * dy
    if L2 <= 0:
        return p.distance_to(seg.start)
    t = max(0, min(1, ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / L2))
    proj = seg.point_at(t)
    return p.distance_to(proj)


def _circle_to_segment_distance(center: Point2D, radius: float, seg: Segment2D) -> float:
    """Distance from circle edge to segment (0 if overlapping)."""
    d = _point_to_segment_distance(center, seg)
    return max(0.0, d - radius)


def parse_dxf_lwpolylines(dxf_path: str | Path) -> Tuple[Drawing, Modelspace]:
    """Load DXF and return document and modelspace."""
    path = Path(dxf_path)
    if not path.exists():
        raise FileNotFoundError(f"DXF file not found: {path}")
    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()
    return doc, msp


def _get_vertices_wcs(lwp: LWPolyline) -> List[Point2D]:
    """Get LWPOLYLINE vertices as 2D points in WCS (z dropped)."""
    try:
        verts = list(lwp.vertices_in_wcs())
    except Exception:
        verts = []
        for i in range(len(lwp)):
            pt = lwp[i]
            x = pt[0]
            y = pt[1]
            verts.append((x, y, lwp.dxf.elevation if hasattr(lwp.dxf, "elevation") else 0))
    return [Point2D(float(v[0]), float(v[1])) for v in verts]


def _get_insunits(doc: Drawing) -> Optional[int]:
    """Get $INSUNITS from DXF header (4=mm, 5=cm, 6=m). Returns None if missing or unitless."""
    try:
        v = doc.header.get("$INSUNITS")
        if v is not None:
            return int(v)
    except Exception:
        pass
    try:
        # ezdxf: doc.units
        u = getattr(doc, "units", None)
        if u is not None and hasattr(u, "value"):
            return getattr(u, "value", None)
    except Exception:
        pass
    return None


def _raw_bbox_from_modelspace(msp: Modelspace) -> Tuple[float, float, float, float]:
    """Compute bounding box from LWPOLYLINE, LINE, CIRCLE in modelspace (raw DXF coordinates)."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    for entity in msp:
        if entity.dxftype() == "LWPOLYLINE":
            verts = _get_vertices_wcs(entity)
            for p in verts:
                min_x, max_x = min(min_x, p.x), max(max_x, p.x)
                min_y, max_y = min(min_y, p.y), max(max_y, p.y)
        elif entity.dxftype() == "LINE":
            try:
                s, e = entity.dxf.start, entity.dxf.end
                for pt in ((s.x, s.y), (e.x, e.y)):
                    min_x, max_x = min(min_x, pt[0]), max(max_x, pt[0])
                    min_y, max_y = min(min_y, pt[1]), max(max_y, pt[1])
            except Exception:
                pass
        elif entity.dxftype() == "CIRCLE":
            try:
                c, r = entity.dxf.center, float(entity.dxf.radius)
                min_x = min(min_x, c.x - r)
                max_x = max(max_x, c.x + r)
                min_y = min(min_y, c.y - r)
                max_y = max(max_y, c.y + r)
            except Exception:
                pass

    if min_x == float("inf"):
        return 0.0, 0.0, 1.0, 1.0
    return min_x, min_y, max_x, max_y


def detect_dxf_units(
    doc: Drawing,
    msp: Modelspace,
    *,
    force_unit: Optional[DetectedUnit] = None,
) -> Tuple[float, DetectedUnit]:
    """
    Detect DXF drawing units and return (scale_to_mm, unit_label).

    - If force_unit is "mm" | "cm" | "m", use it and set scale accordingly.
    - Else read $INSUNITS: 4=mm, 5=cm, 6=m.
    - If header missing or unitless (0): infer from geometry size.
      Typical building: 5–50 m or 5000–50000 mm. If max dimension < 200 → assume meters; else mm.
    """
    if force_unit is not None:
        u = force_unit.lower()
        if u == DETECTED_UNIT_M:
            return (1000.0, DETECTED_UNIT_M)
        if u == DETECTED_UNIT_CM:
            return (10.0, DETECTED_UNIT_CM)
        return (1.0, DETECTED_UNIT_MM)

    insunits = _get_insunits(doc)
    if insunits == 4:
        return (1.0, DETECTED_UNIT_MM)
    if insunits == 5:
        return (10.0, DETECTED_UNIT_CM)
    if insunits == 6:
        return (1000.0, DETECTED_UNIT_M)
    # Unitless or unknown: infer from bounding box
    min_x, min_y, max_x, max_y = _raw_bbox_from_modelspace(msp)
    max_dim = max(max_x - min_x, max_y - min_y, 1.0)
    # Buildings: usually 5–50 m (5–50 in file) or 5000–50000 mm
    if max_dim < 200:
        return (1000.0, DETECTED_UNIT_M)
    return (1.0, DETECTED_UNIT_MM)


def extract_building_perimeter(
    dxf_path: str | Path,
    *,
    building_layer: Optional[str] = None,
    prefer_largest_area: bool = True,
    force_unit: Optional[DetectedUnit] = None,
) -> Tuple[List[BuildingEdge], ObstacleSet, float, DetectedUnit]:
    """
    Parse DXF and extract building perimeter from LWPOLYLINE entities.

    - Building: closed LWPOLYLINE. If building_layer is set, only consider that layer.
      Otherwise take the closed polyline with largest area (or first closed).
    - Obstacles: other closed polylines (e.g. property line), circles (pillars), lines.
    - Units: detected from $INSUNITS (mm/m/cm) or from geometry size; all lengths output in mm.

    Returns:
        edges: List of BuildingEdge (one per side)
        obstacles: ObstacleSet for clearance checks
        scale_to_mm: conversion factor used (1.0 = mm, 1000 = m, 10 = cm)
        detected_unit: "mm" | "m" | "cm"
    """
    doc, msp = parse_dxf_lwpolylines(dxf_path)
    scale_to_mm, detected_unit = detect_dxf_units(doc, msp, force_unit=force_unit)

    closed_polys: List[Tuple[LWPolyline, List[Point2D], float]] = []
    obstacle_segments: List[Segment2D] = []
    obstacle_circles: List[Tuple[Point2D, float]] = []
    obstacle_regions: List[ObstacleRegion] = []

    for entity in msp:
        if entity.dxftype() == "LWPOLYLINE":
            lwp = entity
            layer_raw = lwp.dxf.layer or ""
            layer = layer_raw.upper()
            verts = _get_vertices_wcs(lwp)
            if len(verts) < 3:
                continue
            closed = getattr(lwp, "closed", None)
            if closed is None:
                try:
                    closed = bool(lwp.dxf.flags & 1)  # LWPOLYLINE_CLOSED
                except Exception:
                    closed = False

            # Scale vertices to mm
            verts = [Point2D(p.x * scale_to_mm, p.y * scale_to_mm) for p in verts]
            area = abs(_polygon_area_2d(verts))

            if closed:
                if building_layer and layer != building_layer.upper():
                    segs = _poly_to_segments(verts, closed=True)
                    obstacle_segments.extend(segs)
                    obs_type = _obstacle_type_from_layer(layer_raw)
                    if obs_type:
                        obstacle_regions.append(ObstacleRegion(type=obs_type, segments=segs, circles=[]))
                else:
                    closed_polys.append((lwp, verts, area))
            else:
                segs = _poly_to_segments(verts, closed=False)
                obstacle_segments.extend(segs)
                obs_type = _obstacle_type_from_layer(layer_raw)
                if obs_type:
                    obstacle_regions.append(ObstacleRegion(type=obs_type, segments=segs, circles=[]))

        elif entity.dxftype() == "CIRCLE":
            try:
                layer_raw = getattr(entity.dxf, "layer", None) or ""
                c = entity.dxf.center
                r = float(entity.dxf.radius) * scale_to_mm
                center_pt = Point2D(c.x * scale_to_mm, c.y * scale_to_mm)
                obstacle_circles.append((center_pt, r))
                obs_type = _obstacle_type_from_layer(layer_raw)
                if obs_type:
                    obstacle_regions.append(ObstacleRegion(type=obs_type, segments=[], circles=[(center_pt, r)]))
            except Exception:
                pass
        elif entity.dxftype() == "LINE":
            try:
                layer_raw = getattr(entity.dxf, "layer", None) or ""
                s = entity.dxf.start
                e = entity.dxf.end
                seg = Segment2D(
                    Point2D(s.x * scale_to_mm, s.y * scale_to_mm),
                    Point2D(e.x * scale_to_mm, e.y * scale_to_mm),
                )
                obstacle_segments.append(seg)
                obs_type = _obstacle_type_from_layer(layer_raw)
                if obs_type:
                    obstacle_regions.append(ObstacleRegion(type=obs_type, segments=[seg], circles=[]))
            except Exception:
                pass

    if not closed_polys:
        raise ValueError("No closed LWPOLYLINE found in DXF — cannot define building perimeter")

    if prefer_largest_area:
        closed_polys.sort(key=lambda x: x[2], reverse=True)
    building_verts = closed_polys[0][1]
    for _lwp, verts, _area in closed_polys[1:]:
        obstacle_segments.extend(_poly_to_segments(verts, closed=True))
    obstacles = ObstacleSet(segments=obstacle_segments, circles=obstacle_circles, regions=obstacle_regions)
    # Build edges
    n = len(building_verts)
    labels = ["North", "South", "East", "West"]
    edges: List[BuildingEdge] = []
    for i in range(n):
        j = (i + 1) % n
        seg = Segment2D(building_verts[i], building_verts[j])
        label = labels[i % 4] if n <= 4 else f"edge-{i}"
        edges.append(BuildingEdge(
            index=i,
            label=label,
            segment=seg,
            length_mm=seg.length(),
        ))

    return edges, obstacles, scale_to_mm, detected_unit


def _poly_to_segments(verts: List[Point2D], closed: bool) -> List[Segment2D]:
    out: List[Segment2D] = []
    for i in range(len(verts) - 1):
        out.append(Segment2D(verts[i], verts[i + 1]))
    if closed and len(verts) >= 3:
        out.append(Segment2D(verts[-1], verts[0]))
    return out
