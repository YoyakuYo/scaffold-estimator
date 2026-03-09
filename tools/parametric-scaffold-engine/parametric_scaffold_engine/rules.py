"""
Parametric scaffold rules:
- Variable width per side → offset from wall (Pattanko 200mm + width)
- Buragetto switch: if clearance < (scaffold_width + 200mm) → Single-Pole + Bracket
- Pattanko gap: 200mm in both Double-Post and Bracket modes
- Transitional connection at width changes (corner logic).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

from .geometry import (
    PATTANKO_GAP_MM,
    BuildingEdge,
    ObstacleSet,
    Point2D,
    Segment2D,
)


class LayoutMode(str, Enum):
    DOUBLE_POST = "double_post"
    BRACKET = "bracket"  # Single-pole + Buragetto


# Standard scaffold widths (mm)
SCAFFOLD_WIDTH_MM_OPTIONS = (600, 900, 1200)
MIN_CLEARANCE_FOR_DOUBLE = PATTANKO_GAP_MM  # gap at wall
CLEARANCE_THRESHOLD_EXTRA = 200  # if clearance < width + this → bracket


@dataclass
class SideConfig:
    """Per-side configuration."""
    width_mm: int
    layout_mode: LayoutMode
    clearance_mm: float  # distance from wall to nearest obstacle (for this edge)


def offset_for_side(width_mm: int, layout_mode: LayoutMode) -> Tuple[float, float]:
    """
    Offset from wall (mm).
    Pattanko: gap wall ↔ platform = 200mm always.
    - Double-post: inner row at 200mm, outer at 200 + width_mm.
    - Bracket: single row at 200mm (platform at 200mm, bracket extends outward).
    Returns (offset_inner, offset_outer). For Bracket, offset_outer = offset_inner (no outer row).
    """
    inner = PATTANKO_GAP_MM
    if layout_mode == LayoutMode.BRACKET:
        return (inner, inner)
    return (inner, inner + width_mm)


def check_buragetto(
    width_mm: int,
    obstacles: ObstacleSet,
    edge: BuildingEdge,
) -> LayoutMode:
    """
    If distance from wall (edge) to nearest obstacle < (width_mm + 200mm),
    use Bracket (single-pole + Buragetto); else Double-Post.
    """
    clearance = obstacles.min_distance_to_segment(edge.segment)
    required = width_mm + CLEARANCE_THRESHOLD_EXTRA
    if clearance < required:
        return LayoutMode.BRACKET
    return LayoutMode.DOUBLE_POST


def compute_side_configs(
    edges: List[BuildingEdge],
    width_by_side: Dict[int, int],
    obstacles: ObstacleSet,
) -> List[SideConfig]:
    """
    For each edge, resolve width (from width_by_side or default 900) and
    run Buragetto check to set layout_mode.
    """
    default_width = 900
    configs: List[SideConfig] = []
    for edge in edges:
        width_mm = width_by_side.get(edge.index, default_width)
        clearance = obstacles.min_distance_to_segment(edge.segment)
        layout = check_buragetto(width_mm, obstacles, edge)
        configs.append(SideConfig(width_mm=width_mm, layout_mode=layout, clearance_mm=clearance))
    return configs


@dataclass
class PostPosition:
    """One post position (world coordinates, mm)."""
    x: float
    y: float
    edge_index: int
    t: float  # param along edge 0..1
    row: str  # "inner" | "outer"
    layout_mode: LayoutMode


@dataclass
class TransitionConnection:
    """At a corner where width changes: description of how to connect."""
    corner_index: int  # vertex index (between edge i and i+1)
    edge_before: int
    edge_after: int
    width_before_mm: int
    width_after_mm: int
    inner_point: Point2D
    outer_before: Optional[Point2D] = None
    outer_after: Optional[Point2D] = None
    note: str = ""


def place_posts_along_edge(
    edge: BuildingEdge,
    side_config: SideConfig,
    span_mm: float,
    include_start: bool = True,
    include_end: bool = True,
) -> List[PostPosition]:
    """
    Place post positions along one edge. Sharing at boundaries: posts at 0, span, 2*span, ... up to length.
    span_mm: desired span between posts (e.g. 900, 1200).
    Returns list of PostPosition for this edge (inner and optionally outer row).
    """
    L = edge.length_mm
    if L <= 0 or span_mm <= 0:
        return []

    inner_off, outer_off = offset_for_side(side_config.width_mm, side_config.layout_mode)
    seg = edge.segment
    dx = seg.end.x - seg.start.x
    dy = seg.end.y - seg.start.y
    nx = -dy / (math.hypot(dx, dy) or 1)
    ny = dx / (math.hypot(dx, dy) or 1)
    # Inner row offset from wall
    inner_start = Point2D(seg.start.x + nx * inner_off, seg.start.y + ny * inner_off)
    inner_end = Point2D(seg.end.x + nx * inner_off, seg.end.y + ny * inner_off)
    # Outer row (only for double-post)
    outer_start = Point2D(seg.start.x + nx * outer_off, seg.start.y + ny * outer_off) if side_config.layout_mode == LayoutMode.DOUBLE_POST else None
    outer_end = Point2D(seg.end.x + nx * outer_off, seg.end.y + ny * outer_off) if side_config.layout_mode == LayoutMode.DOUBLE_POST else None

    positions: List[PostPosition] = []
    n_spans = max(0, int(round(L / span_mm)))
    if n_spans == 0:
        if include_start:
            positions.append(PostPosition(
                inner_start.x, inner_start.y, edge.index, 0.0, "inner", side_config.layout_mode
            ))
            if outer_start:
                positions.append(PostPosition(
                    outer_start.x, outer_start.y, edge.index, 0.0, "outer", side_config.layout_mode
                ))
        return positions

    for i in range(n_spans + 1):
        t = i / n_spans if n_spans else 0
        if i == 0 and not include_start:
            continue
        if i == n_spans and not include_end:
            continue
        x_inner = inner_start.x + t * (inner_end.x - inner_start.x)
        y_inner = inner_start.y + t * (inner_end.y - inner_start.y)
        positions.append(PostPosition(
            x_inner, y_inner, edge.index, t, "inner", side_config.layout_mode
        ))
        if outer_start is not None and outer_end is not None:
            x_outer = outer_start.x + t * (outer_end.x - outer_start.x)
            y_outer = outer_start.y + t * (outer_end.y - outer_start.y)
            positions.append(PostPosition(
                x_outer, y_outer, edge.index, t, "outer", side_config.layout_mode
            ))

    return positions


def collect_all_posts(
    edges: List[BuildingEdge],
    side_configs: List[SideConfig],
    span_mm: float,
) -> Tuple[List[PostPosition], List[TransitionConnection]]:
    """
    Place posts on all edges. At shared vertices we include the corner post once per edge
    (so two edges share the same physical corner → one post position from each edge may coincide).
    Also build transition connections where width changes at corners.
    """
    all_posts: List[PostPosition] = []
    transitions: List[TransitionConnection] = []

    n = len(edges)
    for i, (edge, config) in enumerate(zip(edges, side_configs)):
        # Include start of this edge; include end of this edge (next edge will also include it — shared)
        posts = place_posts_along_edge(edge, config, span_mm, include_start=True, include_end=True)
        all_posts.extend(posts)

    # Build transitions at corners where width changes
    for i in range(n):
        j = (i + 1) % n
        cfg_i = side_configs[i]
        cfg_j = side_configs[j]
        if cfg_i.width_mm == cfg_j.width_mm:
            continue
        # Corner at vertex j (end of edge i, start of edge j)
        seg_i = edges[i].segment
        seg_j = edges[j].segment
        # Corner point (shared vertex)
        corner = seg_i.end
        inner_off_i, outer_off_i = offset_for_side(cfg_i.width_mm, cfg_i.layout_mode)
        inner_off_j, outer_off_j = offset_for_side(cfg_j.width_mm, cfg_j.layout_mode)
        # Inner point: offset from corner along bisector or use edge normals
        ni = _edge_outward_normal(seg_i, corner)
        nj = _edge_outward_normal(seg_j, corner)
        # Average normal for inner corner point
        nix, niy = ni
        njx, njy = nj
        ax = (nix + njx) / 2
        ay = (niy + njy) / 2
        la = math.hypot(ax, ay) or 1
        ax, ay = ax / la, ay / la
        # Use max of two inner offsets for transition inner point
        inner_d = max(inner_off_i, inner_off_j)
        inner_pt = Point2D(corner.x + ax * inner_d, corner.y + ay * inner_d)
        outer_before = None
        outer_after = None
        if cfg_i.layout_mode == LayoutMode.DOUBLE_POST:
            outer_before = Point2D(corner.x + nix * outer_off_i, corner.y + niy * outer_off_i)
        if cfg_j.layout_mode == LayoutMode.DOUBLE_POST:
            outer_after = Point2D(corner.x + njx * outer_off_j, corner.y + njy * outer_off_j)

        transitions.append(TransitionConnection(
            corner_index=j,
            edge_before=i,
            edge_after=j,
            width_before_mm=cfg_i.width_mm,
            width_after_mm=cfg_j.width_mm,
            inner_point=inner_pt,
            outer_before=outer_before,
            outer_after=outer_after,
            note=f"Width transition {cfg_i.width_mm}mm → {cfg_j.width_mm}mm at corner {j}",
        ))

    return all_posts, transitions


def _edge_outward_normal(seg: Segment2D, at_vertex: Point2D) -> Tuple[float, float]:
    """Outward normal from segment (pointing away from building if segment is CCW)."""
    dx = seg.end.x - seg.start.x
    dy = seg.end.y - seg.start.y
    L = math.hypot(dx, dy) or 1
    # Left normal: (-dy, dx)
    nx = -dy / L
    ny = dx / L
    # If at_vertex is seg.end, outward is this normal; if at_vertex is seg.start, outward is -normal
    if abs(at_vertex.x - seg.end.x) < 1e-9 and abs(at_vertex.y - seg.end.y) < 1e-9:
        return (nx, ny)
    return (-nx, -ny)
