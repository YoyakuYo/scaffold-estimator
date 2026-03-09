"""
Parametric Scaffold Rule Engine — process building floor plans from DXF.

- Variable width per side (N/S/E/W or by edge index)
- Buragetto (bracket) switch when clearance < scaffold_width + 200mm
- Pattanko gap: 200mm from platform edge to wall in both Double-Post and Bracket modes
- Output: post placement coordinates and transitional connections at width changes
"""

from .engine import ParametricScaffoldEngine, EngineInput, EngineOutput
from .geometry import (
    extract_building_perimeter,
    parse_dxf_lwpolylines,
    detect_dxf_units,
    ObstacleSet,
    ObstacleRegion,
    BuildingEdge,
    DETECTED_UNIT_MM,
    DETECTED_UNIT_CM,
    DETECTED_UNIT_M,
)

__all__ = [
    "ParametricScaffoldEngine",
    "EngineInput",
    "EngineOutput",
    "extract_building_perimeter",
    "parse_dxf_lwpolylines",
    "detect_dxf_units",
    "ObstacleSet",
    "ObstacleRegion",
    "BuildingEdge",
    "DETECTED_UNIT_MM",
    "DETECTED_UNIT_CM",
    "DETECTED_UNIT_M",
]
