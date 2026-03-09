# Parametric Scaffold Rule Engine

Python engine using **ezdxf** to process building floor plans (DXF) and output scaffold post placement with variable width, Buragetto (bracket) switching, and Pattanko gap rules.

## Features

1. **Variable width per side**  
   North, South, East, West (or edge-0, edge-1, …) can have different scaffold widths (e.g. 900mm vs 600mm). The offset from the wall adjusts automatically for each side (inner/outer row positions).

2. **Buragetto (bracket) switch**  
   Collision/clearance check: if the distance between the wall and a detected obstacle (pillar, property line) is less than **(Scaffold Width + 200mm)**, that section is switched from **Double-Post** layout to **Single-Pole + Bracket** (Buragetto) layout.

3. **Pattanko gap**  
   In both Double-Post and Bracket modes, the gap between the platform edge and the wall is kept at **200mm** to accommodate Pattanko flaps.

4. **Geometry**  
   The script parses DXF **LWPOLYLINE** for the building perimeter and outputs:
   - A list of **post placement coordinates** (inner and, where applicable, outer row).
   - **Transitional connection** logic at corners where the width changes (e.g. North 900mm → East 600mm).

## Setup

Use a Python environment that has `pip` (e.g. Python 3.9–3.12 from python.org or your OS package manager).

```bash
cd tools/parametric-scaffold-engine
pip install -r requirements.txt
# Or install the package with deps: pip install -e .
```

## Usage

### Python API

```python
from pathlib import Path
from parametric_scaffold_engine import ParametricScaffoldEngine, EngineInput

inp = EngineInput(
    dxf_path=Path("building.dxf"),
    width_by_side={0: 900, 1: 600, 2: 900, 3: 600},  # N, S, E, W in mm
    span_mm=900.0,
    building_layer=None,  # or "BUILDING"
)
engine = ParametricScaffoldEngine()
out = engine.run(inp)

# Post coordinates
for p in out.post_positions:
    print(p.x, p.y, p.row, p.layout_mode)

# Transition connections at width changes
for t in out.transition_connections:
    print(t.note, t.inner_point.x, t.inner_point.y)
```

### CLI

```bash
# Default: single width 900mm, span 900mm
python -m parametric_scaffold_engine path/to/plan.dxf

# Per-side widths (N,S,E,W): 900, 600, 900, 600 mm
python -m parametric_scaffold_engine plan.dxf --width 900,600,900,600

# Custom span and JSON output
python -m parametric_scaffold_engine plan.dxf --span 1200 --json
```

## DXF assumptions

- **Building perimeter**: closed **LWPOLYLINE** (largest by area is used if multiple closed polylines exist).
- **Obstacles** (for Buragetto clearance and reporting):
  - Other closed LWPOLYLINEs (e.g. property line),
  - **CIRCLE** entities (pillars),
  - **LINE** entities.
  - **Balcony and AC areas**: if DXF layer names contain `BALCONY`, `VERANDA`, `ベランダ`, `バルコニー`, or `AC`, `室外機`, `エアコン`, `AIRCON`, those entities are treated as obstacles and reported as `balcony` / `ac` in `detected_obstacle_regions`.
- **Units**: The platform detects **millimetres** and **metres** (and centimetres):
  - From DXF header **$INSUNITS**: 4 = mm, 5 = cm, 6 = m (all output coordinates are in mm).
  - If the header is missing or unitless, units are inferred from geometry size (max dimension &lt; 200 → metres, else mm).
  - You can override with `--unit mm` or `--unit m` (or `EngineInput.force_unit` in the API).

## Output

- **Post positions**: `(x, y)` in mm, with `edge_index`, `t` (0–1 along edge), `row` (inner/outer), `layout_mode` (double_post / bracket).
- **Transition connections**: at each corner where width changes, `inner_point`, optional `outer_before` / `outer_after`, and a short description for connecting the two widths.

## Integration with the main app

The main stack is Node/TypeScript. You can:

- Call this engine from the backend via `child_process.spawn("python", ["-m", "parametric_scaffold_engine", dxfPath, "--json"])` and parse JSON.
- Or port the rules into TypeScript and keep using the existing `dxf-parser` + geometry; this Python module remains the reference implementation with ezdxf.
