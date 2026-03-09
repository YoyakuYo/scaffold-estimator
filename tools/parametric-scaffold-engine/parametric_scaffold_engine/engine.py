"""
Parametric Scaffold Rule Engine — main entry.

1. Variable width per side (offset adjusts automatically).
2. Buragetto switch when clearance < scaffold_width + 200mm.
3. Pattanko gap 200mm in both Double-Post and Bracket modes.
4. Output: post placement coordinates + transitional connections at width changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .geometry import (
    BuildingEdge,
    ObstacleSet,
    Point2D,
    extract_building_perimeter,
    parse_dxf_lwpolylines,
)
from .rules import (
    LayoutMode,
    PostPosition,
    SideConfig,
    TransitionConnection,
    compute_side_configs,
    collect_all_posts,
)


@dataclass
class EngineInput:
    """Input to the parametric scaffold engine."""
    dxf_path: str | Path
    # Per-edge scaffold width (mm). Key = edge index. Default 900 if not set.
    width_by_side: Dict[int, int] = field(default_factory=dict)
    # Span between posts along each edge (mm), e.g. 900 or 1200.
    span_mm: float = 900.0
    # Optional: only consider this layer as building perimeter.
    building_layer: Optional[str] = None


@dataclass
class EdgeResult:
    """Result for one building edge."""
    edge_index: int
    label: str
    length_mm: float
    width_mm: int
    layout_mode: LayoutMode
    clearance_mm: float
    post_positions: List[PostPosition]


@dataclass
class EngineOutput:
    """Output: post coordinates and transitional connections."""
    edges: List[BuildingEdge]
    side_configs: List[SideConfig]
    post_positions: List[PostPosition]
    transition_connections: List[TransitionConnection]
    edge_results: List[EdgeResult]
    scale_to_mm: float

    def post_coordinates_list(self) -> List[Dict]:
        """List of post coordinates for export (e.g. JSON)."""
        return [
            {
                "x": p.x,
                "y": p.y,
                "edge_index": p.edge_index,
                "t": p.t,
                "row": p.row,
                "layout_mode": p.layout_mode.value,
            }
            for p in self.post_positions
        ]

    def transition_summary(self) -> List[Dict]:
        """Transition connections for export."""
        return [
            {
                "corner_index": t.corner_index,
                "edge_before": t.edge_before,
                "edge_after": t.edge_after,
                "width_before_mm": t.width_before_mm,
                "width_after_mm": t.width_after_mm,
                "inner_point": {"x": t.inner_point.x, "y": t.inner_point.y},
                "outer_before": {"x": o.x, "y": o.y} if (o := t.outer_before) else None,
                "outer_after": {"x": o.x, "y": o.y} if (o := t.outer_after) else None,
                "note": t.note,
            }
            for t in self.transition_connections
        ]


class ParametricScaffoldEngine:
    """
    Parametric Scaffold Rule Engine using ezdxf.

    - Parses DXF LWPOLYLINE for building perimeter.
    - Variable width per side; offset from wall adjusts (Pattanko 200mm + width).
    - Buragetto: if clearance < width + 200mm → Single-Pole + Bracket.
    - Outputs post placement coordinates and transitional connection logic.
    """

    def run(self, inp: EngineInput) -> EngineOutput:
        """
        Process DXF and return post positions and transitions.
        """
        edges, obstacles, scale_to_mm = extract_building_perimeter(
            inp.dxf_path,
            building_layer=inp.building_layer,
            prefer_largest_area=True,
        )
        side_configs = compute_side_configs(edges, inp.width_by_side, obstacles)
        post_positions, transition_connections = collect_all_posts(
            edges, side_configs, inp.span_mm
        )

        # Per-edge post lists for convenience
        posts_by_edge: Dict[int, List[PostPosition]] = {}
        for p in post_positions:
            posts_by_edge.setdefault(p.edge_index, []).append(p)

        edge_results: List[EdgeResult] = []
        for i, (edge, config) in enumerate(zip(edges, side_configs)):
            edge_results.append(EdgeResult(
                edge_index=edge.index,
                label=edge.label,
                length_mm=edge.length_mm,
                width_mm=config.width_mm,
                layout_mode=config.layout_mode,
                clearance_mm=config.clearance_mm,
                post_positions=posts_by_edge.get(edge.index, []),
            ))

        return EngineOutput(
            edges=edges,
            side_configs=side_configs,
            post_positions=post_positions,
            transition_connections=transition_connections,
            edge_results=edge_results,
            scale_to_mm=scale_to_mm,
        )
