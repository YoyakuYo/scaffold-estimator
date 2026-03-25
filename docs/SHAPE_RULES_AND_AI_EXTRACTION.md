# Building Shape Rules & AI Extraction Guide

## Purpose
This document defines the exhaustive rules for AI extraction of building shapes from
BIM/IFC files, PDF images, CAD drawings, and 3D renders. It also defines the scaffold
calculation rules for each shape type, including corner closing, the 300mm overhang rule,
and PATTANKO placement.

---

## 1. Supported Building Shapes

### 1.1 Rectangle (矩形)
- **Vertices:** 4
- **Walls:** 4 (W, D, W, D)
- **Corners:** 4 × 90° convex
- **Corner type:** All L-shaped (90°)
- **Detection from 3D:** NEVER output 5 or 6 vertices. A box in perspective is still 4 vertices.
- **Detection from plan:** 4 outer corners, ignore interior partitions.
- **Scaffold:** Standard closed polygon. Each corner gets yokoji + deck + habaki (L-corner treatment).
- **Wall count check:** `sum(horizontal walls) = W+W`, `sum(vertical walls) = D+D`

```
  ┌──────────W──────────┐
  │                      │
  D                      D
  │                      │
  └──────────W──────────┘
  4 vertices, 4 walls
```

### 1.2 L-Shape (L字型)
- **Vertices:** 6
- **Walls:** 6
- **Corners:** 5 × 90° convex + 1 × 270° reflex (inner corner)
- **Corner type:** 5 L-shaped corners + 1 reflex corner (PATTANKO or special treatment)
- **Closure check:** `sum(rightward edges) = sum(leftward edges)`, `sum(downward edges) = sum(upward edges)`

```
  Standard L:              Flipped L (mirrored):      Rotated L (upside-down):
  ┌────A────┐              ┌────A────────────┐        ┌────────────C────┐
  │         │              │                 │        │                 │
  B         │              B                 │        │                 B
  │    ┌──C─┘              │         ┌───C───┘        └──C──┐          │
  │    │                   │         │                      │          │
  D    │                   D         │                      │          D
  │    │                   │         │                      │          │
  └──E─┘                   └────E────┘                 ┌──E─┘          │
                                                       │               │
                                                       └───────A───────┘
```

**L-Shape wall equations (orthogonal closure):**
- Wall 0 (top horizontal): A
- Wall 1 (right vertical): B
- Wall 2 (step horizontal): C
- Wall 3 (inner vertical): D - B (or the step height)
- Wall 4 (bottom horizontal): A + C (or E = total width - A)
- Wall 5 (left vertical): D
- **Check:** A + C = E (total horizontal), B + (D-B) = D (total vertical)
- More precisely: `A + C = E` AND `B + step_height = D`

**AI extraction rules for L-shape:**
1. The reflex (inner) corner is where the notch cuts inward
2. NEVER split an L into two rectangles — it is ONE polygon with 6 vertices
3. wallLengthsMm must have exactly 6 values
4. The sum of parallel edges must balance (horizontal left = horizontal right)

### 1.3 U-Shape (U字型 / コの字型)
- **Vertices:** 8
- **Walls:** 8
- **Corners:** 6 × 90° convex + 2 × 270° reflex (inner corners)
- **Corner type:** 6 L-shaped + 2 PATTANKO

```
  Standard U:                    Flipped U (upside-down):
  ┌──A──┐         ┌──A──┐       ┌──────────E──────────┐
  │     │         │     │       │                      │
  B     │  inner  │     B       B     ┌──C──┐          B
  │     │  court  │     │       │     │     │          │
  │     └───C─────┘     │       │     │     │          │
  │                     │       └──A──┘     └────A─────┘
  D                     D
  │                     │
  └─────────E───────────┘
```

**U-Shape wall equations:**
- Horizontal: `A + C + A = E` (two wings + courtyard width = total bottom)
- Vertical: `B + (D-B) = D` on each side
- **Check:** `2A + C = E` AND both vertical sides add up to D

**AI extraction rules for U-shape:**
1. Two reflex corners where the courtyard opens
2. 8 vertices exactly, no more
3. The courtyard is an OPEN AREA — scaffold wraps around the inside too
4. Each inner wall of the courtyard gets its own scaffold run

### 1.4 T-Shape (T字型)
- **Vertices:** 8
- **Walls:** 8
- **Corners:** 6 × 90° convex + 2 × 270° reflex

```
  ┌────────────A────────────┐
  │                          │
  B                          B
  │     ┌──C──┐              │
  │     │     │              │
  └──D──┘     └──────D───────┘
              E (stem width)
              │     │
              F     F
              │     │
              └──E──┘
```

**T-Shape wall equations:**
- Top: A (full width)
- Stem: E (narrower)
- **Check:** `D + E + D = A` (left gap + stem + right gap = full width)

### 1.5 H-Shape (H字型)
- **Vertices:** 12
- **Walls:** 12
- **Corners:** 8 × 90° convex + 4 × 270° reflex

### 1.6 Courtyard / O-Shape (ロ字型)
- **Vertices:** 4 outer + 4 inner (two polygons)
- Treated as U-shape with very small opening or as separate inner/outer polygons

### 1.7 Irregular / Angled Buildings
- Walls at non-90° angles
- Each wall segment is ONE edge with ONE length
- Vertex positions define angles — lengths alone are insufficient
- Use Pythagorean theorem for angled walls without dimension annotations

---

## 2. Corner Closing Rules (足場コーナー閉塞ルール)

### 2.1 The 300mm Overhang Rule
At every building corner where two walls meet:
- The scaffold posts extend **300mm beyond** the building corner
- This creates a **CORNER_SPAN** of 600mm (kusabi) or 610mm (wakugumi) at the corner
- The shared post at the corner is used by BOTH adjacent walls

```
  Building Corner
        │
        ▼
  ──────┤
        │←300mm→│
        │       ├── Shared post (used by both walls)
        │       │
        │  600mm span (corner span)
```

### 2.2 L-Shaped Corner (90° convex)
- Standard treatment: yokoji (horizontal pipe) + deck + habaki
- Both walls share the corner post
- Scaffold platform bridges the gap between inner and outer rows
- **CRITICAL:** The scaffold MUST close at L-corners — no gap allowed

### 2.3 Reflex Corner (270° / inner corner)
- PATTANKO (パッタンコ) filler plank
- 2 PATTANKO pieces per corner per level
- Bridges the gap where inner rows of adjacent walls don't meet
- Size: ~250mm × 500mm cross pattern

### 2.4 Corner Detection Thresholds
```
cos(angle) < 0.35  → L-shaped corner (deck + yokoji treatment)
cos(angle) >= 0.35 AND cos(angle) < 0.98  → Non-L corner (PATTANKO treatment)
cos(angle) >= 0.98 → Straight (not a corner, collinear walls)
```

### 2.5 Corner Span Calculation
**Kusabi (くさび式):**
- `CORNER_OVERRUN_MM = 300`
- `CORNER_SPAN_MM = 600`
- Wall run = wallLength + 300mm
- First span = 600mm, Last span = 600mm
- Middle = wallLength - 2×600 - 300 = wallLength - 1500mm (fitted with standard spans)

**Wakugumi (枠組):**
- `CORNER_OVERRUN_MM = 300`
- `CORNER_SPAN_MM = 610`
- Wall run = wallLength + 300mm
- First span = 610mm, Last span = 610mm
- Middle = wallLength - 2×610 - 300 = wallLength - 1520mm (fitted with imperial spans)

---

## 3. AI Extraction Rules by Input Type

### 3.1 Floor Plans (PDF/Image)
1. **Identify exterior shell** — thickest walls at building edge
2. **Detect protruding sections:**
   - INCLUDE: enclosed rooms/wings with thick structural walls
   - INCLUDE: stairwell enclosures with thick walls
   - EXCLUDE: open terraces (thin lines, railings, no walls)
   - EXCLUDE: balconies, canopies, external stairs
3. **Trace outer perimeter** clockwise, vertex at each direction change
4. **Assign dimensions** from parallel dimension lines
5. **Detect doors:** quarter-circle swing arcs on EXTERIOR walls only
6. **Detect terraces:** labels like "Terrace", "Deck", "テラス", "Patio"

### 3.2 3D BIM Renders / Isometric Views
1. **Reconstruct top-down plan** — NOT the visible silhouette
2. **Simple rectangle check:** All walls flush = 4 vertices ONLY
3. **Perspective illusion warning:** 3/4 angle hexagon ≠ hexagonal building
4. **Count floors** for height estimation (3000-4000mm per story)
5. **Detect stepped rooflines** → wallHeightsMm + massingTiers

### 3.3 IFC/BIM Files
1. **Stream all meshes** and collect vertices
2. **Select footprint plane** (XY, XZ, or YZ — smallest span axis = vertical)
3. **Ground band filter** — bottom 30% of height for footprint
4. **Occupancy grid** → morphological close → flood fill → boundary trace
5. **Cleanup:** remove collinear vertices, collapse grid artifacts
6. **Wall heights:** sample point cloud near each edge for per-wall height

### 3.4 DXF/CAD Files
1. **Score closed polylines** — prefer large area, orthogonal, building layers
2. **LINE-based detection** — graph + rightmost-turn outer boundary walk
3. **Pillar detection** — CIRCLE entities near perimeter
4. **No automatic door/terrace detection** — geometry only

---

## 4. Shape-Specific Scaffold Calculation Rules

### 4.1 Rectangle (4 walls, 4 corners)
```
Walls: [W, D, W, D]
Corners: 4 × L-shaped
Posts per wall: spans + 1 (shared at corners)
Total posts: Σ(spans_i) + 4 (sharing at 4 corners) × 2 rows
Corner treatment: 4 × L-corner deck + yokoji per level
PATTANKO: 0 (all corners are L-shaped)
```

### 4.2 L-Shape (6 walls, 6 corners)
```
Walls: [A, B, C, step_h, E, D] (6 values)
Corners: 5 × L-shaped + 1 × reflex
Posts per wall: spans_i + 1 (shared at corners)
Corner treatment: 5 × L-corner deck + yokoji per level
PATTANKO: 1 reflex corner × 2 per level
Closure check: A + C = E, B + step_h = D
```

### 4.3 U-Shape (8 walls, 8 corners)
```
Walls: 8 values
Corners: 6 × L-shaped + 2 × reflex
Corner treatment: 6 × L-corner deck + yokoji per level
PATTANKO: 2 reflex corners × 2 per level
Closure check: 2A + C = E (horizontal), both sides add to D (vertical)
```

### 4.4 T-Shape (8 walls, 8 corners)
```
Walls: 8 values
Corners: 6 × L-shaped + 2 × reflex
Corner treatment: 6 × L-corner deck + yokoji per level
PATTANKO: 2 reflex corners × 2 per level
Closure check: D + E + D = A (stem + gaps = full width)
```

---

## 5. Preventing AI Hallucination / Guessing

### 5.1 Vertex Count Validation
| Shape      | Vertices | Walls | Convex corners | Reflex corners |
|------------|----------|-------|----------------|----------------|
| Rectangle  | 4        | 4     | 4              | 0              |
| L-shape    | 6        | 6     | 5              | 1              |
| U-shape    | 8        | 8     | 6              | 2              |
| T-shape    | 8        | 8     | 6              | 2              |
| H-shape    | 12       | 12    | 8              | 4              |
| + shape    | 12       | 12    | 8              | 4              |

### 5.2 Orthogonal Closure Check
For any orthogonal building (all 90° corners):
```
sum(rightward wall lengths) MUST = sum(leftward wall lengths)
sum(downward wall lengths) MUST = sum(upward wall lengths)
```
If these don't balance, a dimension is WRONG — re-read the drawing.

### 5.3 Perimeter Sanity Check
- Minimum wall: 600mm (smallest scaffold span)
- Maximum wall: 200,000mm (200m — extremely long)
- Total perimeter: > 4m and < 2000m
- No duplicate consecutive vertices
- No self-intersecting edges

### 5.4 Height Sanity Check
- Minimum: 1000mm (1m)
- Maximum: 300,000mm (300m — tallest buildings)
- Floor height: 2500-4000mm typical
- floorCount × 3000mm = reasonable height estimate

### 5.5 Shape Consistency Check
- 3D BIM render of simple box → EXACTLY 4 vertices
- Floor plan with L-notch → EXACTLY 6 vertices
- U-shaped courtyard → EXACTLY 8 vertices
- wallLengthsMm count MUST = vertices count
- wallHeightsMm count MUST = vertices count (if provided)

---

## 6. Terrace & Door Detection Rules

### 6.1 Terrace Detection
**INCLUDE in footprint (structural):**
- Thick walls on ALL sides
- Same wall thickness as main building
- Enclosed rooms/spaces
- Labels: stairwell, elevator shaft, enclosed porch

**EXCLUDE from footprint (non-structural):**
- Thin lines or dashed lines on outer edge
- Railings/posts instead of walls
- Labels: "Terrace", "Deck", "テラス", "Patio", "Balcony"
- Open air on outer boundary

**Edge case:** Upper floors extending over open terrace below:
- Use FULL building dimension for wall length (includes terrace zone)
- Terrace level has shorter scaffold (different wallHeightsMm)

### 6.2 Door Detection
- Quarter-circle swing arcs on EXTERIOR walls
- Sliding doors shown as arrows/dashed lines
- IGNORE interior doors between rooms
- Each exterior door needs a beam frame bracket on scaffold
- Default door width: 1800mm if not dimensioned
- Report: wallIndex (which wall), positionMm (distance from wall start), widthMm

---

## 7. Corner Closing in 3D Visualization

### 7.1 L-Corner (90° convex)
At each L-corner between wall A and wall B:
1. Take last 2 post positions from wall A (outer + inner row)
2. Take first 2 post positions from wall B (outer + inner row)
3. Draw yokoji pipes connecting them
4. Extrude deck quadrilateral between the 4 posts
5. Add habaki on exposed edges

### 7.2 Non-L Corner (reflex / obtuse)
At each non-90° corner:
1. Place 2 PATTANKO pieces in cross pattern
2. Size: ~250mm × 500mm each
3. Centered at the midpoint of the 4 corner posts

### 7.3 Corner Validation
- Every corner in a closed polygon MUST have either L-corner or PATTANKO treatment
- No gaps between adjacent wall scaffold runs
- The 300mm overhang ensures overlap at corners

---

## 8. Image Analysis Reference (from provided images)

### Image 1: 5-story residential block (rectangular)
- Shape: Rectangle (4 vertices)
- Estimated: ~40m × 12m × 15m (5 floors)
- Scaffold: 4 walls, 4 L-corners
- AI must NOT trace perspective hexagon

### Image 2: Corner European-style building (irregular/trapezoidal)
- Shape: Irregular polygon (~5-6 vertices)
- Has angled corners (not all 90°)
- AI must trace actual wall angles, not regularize

### Image 3: Detailed floor plan with rooms
- Shape: Must extract EXTERIOR shell only
- Ignore: bathrooms, bedrooms, kitchen walls
- Include: stairwell if enclosed with thick walls
- Detect: exterior doors (swing arcs on outer walls)
- Detect: terraces/balconies (exclude from polygon)

### Image 4: Large office/commercial building
- Shape: Rectangle or slight L (4-6 vertices)
- Multiple floors visible → count for height
- Rooftop structures: NOT part of footprint

### Image 5: Floor plan with dimensions in meters
- Shape: Extract from thick outer walls
- Convert all dimensions to mm
- Terrace area: EXCLUDE (labeled "Terrace")
- Detect ALL exterior doors

### Image 6: Irregular angled floor plan
- Shape: Non-orthogonal polygon
- Each angled wall = ONE edge
- Vertex positions MUST match actual corner locations
- Do NOT create regular polygon

### Image 7: Building with scaffold already installed
- Shape: Extract building outline (INNER edge of scaffold/blue zone)
- NOT the outer scaffold boundary

### Image 8: Multi-wing complex building
- Shape: Complex L or stepped
- May need massingTiers for different heights
- Multiple wings = more vertices

### Image 9: Large modern building with glass facade
- Shape: Rectangle or simple L
- Height from floor count
- Ignore canopies, entrance structures

### Image 10: BIM software screenshot (IFC viewer)
- Shape: U-shape or L-shape visible in 3D view
- Multiple stories, glass facade visible
- Extract from geometry data, not screenshot

---

## 9. Summary: Critical Rules to Prevent Errors

1. **NEVER guess vertex count** — count the actual direction changes in the footprint
2. **NEVER trace perspective silhouette** — reconstruct top-down plan from 3D views
3. **ALWAYS close the polygon** — last edge connects back to vertex[0]
4. **ALWAYS balance orthogonal dimensions** — horizontal sums must match, vertical sums must match
5. **ALWAYS use 300mm overhang** at corners for scaffold closing
6. **ALWAYS detect and count doors** on exterior walls for beam frame placement
7. **ALWAYS distinguish terraces** (exclude) from structural wings (include)
8. **NEVER add vertices for height changes** — use wallHeightsMm instead
9. **NEVER use bounding box** for L/U/T shapes — trace the actual concave outline
10. **ALWAYS verify wall count matches vertex count** — they must be equal
