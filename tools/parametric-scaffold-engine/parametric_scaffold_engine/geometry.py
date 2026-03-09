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


@dataclass
class ObstacleSet:
    """Obstacles for clearance check: segments and circles (pillars)."""
    segments: List[Segment2D] = field(default_factory=list)
    circles: List[Tuple[Point2D, float]] = field(default_factory=list)  # (center, radius_mm)

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


def extract_building_perimeter(
    dxf_path: str | Path,
    *,
    building_layer: Optional[str] = None,
    prefer_largest_area: bool = True,
) -> Tuple[List[BuildingEdge], ObstacleSet, float]:
    """
    Parse DXF and extract building perimeter from LWPOLYLINE entities.

    - Building: closed LWPOLYLINE. If building_layer is set, only consider that layer.
      Otherwise take the closed polyline with largest area (or first closed).
    - Obstacles: other closed polylines (e.g. property line), circles (pillars), lines
      on layers that suggest obstacles (e.g. "OBSTACLE", "PILLAR", "PROPERTY").
    - Units: assumed mm; scale_to_mm can convert (e.g. 1000 if DXF in meters).

    Returns:
        edges: List of BuildingEdge (one per side)
        obstacles: ObstacleSet for clearance checks
        scale_to_mm: 1.0 or conversion factor from DXF units to mm
    """
    doc, msp = parse_dxf_lwpolylines(dxf_path)

    # DXF units → mm
    scale_to_mm = 1.0
    try:
        insunits = doc.header.get("$INSUNITS", 4)
        if insunits == 5:
            scale_to_mm = 10.0   # cm → mm
        elif insunits == 6:
            scale_to_mm = 1000.0  # m → mm
        # 4 = mm
    except Exception:
        pass

    closed_polys: List[Tuple[LWPolyline, List[Point2D], float]] = []
    obstacle_segments: List[Segment2D] = []
    obstacle_circles: List[Tuple[Point2D, float]] = []

    for entity in msp:
        if entity.dxftype() == "LWPOLYLINE":
            lwp = entity
            layer = (lwp.dxf.layer or "").upper()
            verts = _get_vertices_wcs(lwp)
            if len(verts) < 3:
                continue
            closed = getattr(lwp, "closed", None)
            if closed is None:
                try:
                    closed = bool(lwp.dxf.flags & 1)  # LWPOLYLINE_CLOSED
                except Exception:
                    closed = False

            # Scale vertices
            verts = [Point2D(p.x * scale_to_mm, p.y * scale_to_mm) for p in verts]
            area = abs(_polygon_area_2d(verts))

            if closed:
                # Heuristic: building is usually the largest closed polygon; obstacles might be named
                if building_layer and layer != building_layer.upper():
                    obstacle_segments.extend(_poly_to_segments(verts, closed=True))
                else:
                    closed_polys.append((lwp, verts, area))
            else:
                # Open polylines as obstacle segments (e.g. property lines)
                obstacle_segments.extend(_poly_to_segments(verts, closed=False))

        elif entity.dxftype() == "CIRCLE":
            try:
                c = entity.dxf.center
                r = float(entity.dxf.radius) * scale_to_mm
                obstacle_circles.append((Point2D(c.x * scale_to_mm, c.y * scale_to_mm), r))
            except Exception:
                pass
        elif entity.dxftype() == "LINE":
            try:
                s = entity.dxf.start
                e = entity.dxf.end
                obstacle_segments.append(Segment2D(
                    Point2D(s.x * scale_to_mm, s.y * scale_to_mm),
                    Point2D(e.x * scale_to_mm, e.y * scale_to_mm),
                ))
            except Exception:
                pass

    if not closed_polys:
        raise ValueError("No closed LWPOLYLINE found in DXF — cannot define building perimeter")

    if prefer_largest_area:
        closed_polys.sort(key=lambda x: x[2], reverse=True)
    building_verts = closed_polys[0][1]
    # Add other closed polylines (e.g. property line, interior) as obstacles
    for _lwp, verts, _area in closed_polys[1:]:
        obstacle_segments.extend(_poly_to_segments(verts, closed=True))
    obstacles = ObstacleSet(segments=obstacle_segments, circles=obstacle_circles)
    is_ccw = _is_ccw(building_verts)
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

    return edges, obstacles, scale_to_mm


def _poly_to_segments(verts: List[Point2D], closed: bool) -> List[Segment2D]:
    out: List[Segment2D] = []
    for i in range(len(verts) - 1):
        out.append(Segment2D(verts[i], verts[i + 1]))
    if closed and len(verts) >= 3:
        out.append(Segment2D(verts[-1], verts[0]))
    return out
