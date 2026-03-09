"""
CLI entry: python -m parametric_scaffold_engine <dxf_path> [options]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .engine import EngineInput, ParametricScaffoldEngine


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parametric Scaffold Rule Engine — process DXF floor plans for post placement"
    )
    parser.add_argument("dxf_path", type=Path, help="Path to DXF file")
    parser.add_argument(
        "--span",
        type=float,
        default=900,
        help="Span between posts (mm), default 900",
    )
    parser.add_argument(
        "--width",
        type=str,
        default="",
        help="Per-edge widths: comma-separated mm, e.g. 900,600,900,600 for N,S,E,W",
    )
    parser.add_argument(
        "--layer",
        type=str,
        default=None,
        help="Building perimeter layer name (optional)",
    )
    parser.add_argument(
        "--unit",
        type=str,
        choices=["mm", "m", "cm"],
        default=None,
        help="Force DXF unit: mm, m, or cm. If not set, auto-detect from $INSUNITS or geometry.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output full result as JSON",
    )
    args = parser.parse_args()

    width_by_side: dict[int, int] = {}
    if args.width:
        for i, w in enumerate(args.width.split(",")):
            w = w.strip()
            if w.isdigit():
                width_by_side[i] = int(w)

    inp = EngineInput(
        dxf_path=args.dxf_path,
        width_by_side=width_by_side,
        span_mm=args.span,
        building_layer=args.layer,
        force_unit=args.unit,
    )

    try:
        engine = ParametricScaffoldEngine()
        out = engine.run(inp)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        obj = {
            "detected_unit": out.detected_unit,
            "scale_to_mm": out.scale_to_mm,
            "detected_obstacle_regions": getattr(out, "detected_obstacle_regions", []),
            "post_positions": out.post_coordinates_list(),
            "transition_connections": out.transition_summary(),
            "edges": [
                {
                    "index": e.index,
                    "label": e.label,
                    "length_mm": e.length_mm,
                }
                for e in out.edges
            ],
            "edge_results": [
                {
                    "edge_index": er.edge_index,
                    "label": er.label,
                    "length_mm": er.length_mm,
                    "width_mm": er.width_mm,
                    "layout_mode": er.layout_mode.value,
                    "clearance_mm": round(er.clearance_mm, 2),
                    "post_count": len(er.post_positions),
                }
                for er in out.edge_results
            ],
        }
        print(json.dumps(obj, indent=2))
        return

    # Human-readable summary
    print("Parametric Scaffold Rule Engine — Result")
    print("=" * 50)
    print(f"  DXF units detected: {out.detected_unit} (output coordinates in mm)")
    for er in out.edge_results:
        print(f"  {er.label} (edge {er.edge_index}): length={er.length_mm:.0f}mm, width={er.width_mm}mm, layout={er.layout_mode.value}, clearance={er.clearance_mm:.0f}mm, posts={len(er.post_positions)}")
    print(f"\nTotal post positions: {len(out.post_positions)}")
    print(f"Width transitions: {len(out.transition_connections)}")
    regions = getattr(out, "detected_obstacle_regions", []) or []
    if regions:
        bal = sum(1 for r in regions if r.get("type") == "balcony")
        ac = sum(1 for r in regions if r.get("type") == "ac")
        if bal or ac:
            print(f"Detected obstacles: {bal} balcony area(s), {ac} AC area(s)")
    if out.transition_connections:
        for t in out.transition_connections:
            print(f"  — {t.note}")


if __name__ == "__main__":
    main()
