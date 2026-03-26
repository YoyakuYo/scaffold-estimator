# Building Shape Rules for AI Extraction & Scaffold Calculation

## 1. Shape Classification System

Every building footprint falls into one of these categories based on vertex count and corner angles:

### 1.1 Rectangle (矩形) — 4 vertices
```
 X1          X2
  ┌──────────┐
  │          │  Y1
  │          │
  └──────────┘
 X4          X3
```
- **Vertices**: 4 (all 90° convex corners)
- **Walls**: 4 (N=Y1, E=X2, S=Y2, W=X1)
- **XY Notation**: X1, X2 (short sides), Y1, Y2 (long sides)
- **Corner count**: 4 (all L-shaped, all need yokoji+deck closure)
- **Pattanko**: 0 (all corners are 90°)
- **Math check**: X1 == X2 (opposite sides equal), Y1 == Y2 (opposite sides equal)
- **AI extraction**: 4 vertices, 4 wallLengthsMm entries
- **Scaffold rule**: `fitSpansToWallLengthWithCorner(wallLengthMm)` for each wall
  - Each wall = [600, ...middle_spans..., 600] with 300mm overrun budget

### 1.2 L-Shape (L字型) — 6 vertices
```
 V0────────V1          Standard L
 │          │
 │          V2──────V3
 │                   │
 V5─────────────────V4
```
- **Vertices**: 6 (5 convex 90° + 1 reflex 270° at V2)
- **Walls**: 6
- **Reflex corner**: 1 at V2 (inner corner)
- **XY Notation example**: X1(V0→V1), Y1(V1→V2), X2(V2→V3), Y2(V3→V4), X3(V4→V5), Y3(V5→V0)
- **Math check**:
  - Horizontal: X1 + X2 = X3 (top short + notch = bottom long)
  - Vertical: Y1 + Y2 = Y3 (or Y3 = Y1 + Y2)
  - Sum of rightward edges = sum of leftward edges
  - Sum of downward edges = sum of upward edges
- **Corner closure**: 6 corners, 5 with yokoji+deck (convex), 1 reflex corner with special handling
- **Pattanko**: 0 if all ~90° angles
- **AI extraction**: Must detect the concave vertex; NEVER simplify to 4-vertex rectangle

#### L-Shape Variants (rotated/flipped):
```
 Standard L    Flipped L     Rotated L-90   Rotated L-180
 ┌──┐          ┌──┐          ┌────────┐      ┌────────┐
 │  │          │  │          │        │      │        │
 │  └────┐     ┌────┘  │     └──┐     │      │     ┌──┘
 │       │     │       │        │     │      │     │
 └───────┘     └───────┘        └─────┘      └─────┘
```
All L variants have the same rules: 6 vertices, 1 reflex corner.

### 1.3 U-Shape (U字型/コの字型) — 8 vertices
```
 V0──V1    V2──V3
 │    │    │    │
 │    V6──V7    │   (courtyard inside)
 │              │
 V5────────────V4
```
- **Vertices**: 8 (6 convex + 2 reflex at V6 and V7)
- **Walls**: 8
- **Reflex corners**: 2 (inner courtyard corners)
- **Math check**:
  - Bottom: X_bottom = X_left_wing + X_courtyard + X_right_wing
  - Left height = right height (Y_left = Y_right)
  - Courtyard depth < total depth
  - Sum rightward = sum leftward; sum downward = sum upward
- **AI extraction**: Detect both reflex corners for the courtyard opening

#### U-Shape Variants:
```
 U (open top)  ∩ (open bottom)  ⊂ (open right)  ⊃ (open left)
 ┌─┐    ┌─┐    ┌──────────┐     ┌──────────┐    ┌──────────┐
 │ │    │ │    │          │     │          │    │          │
 │ └────┘ │    │ ┌────┐   │     │   ┌──┐   │    │   ┌──┐  │
 │        │    │ │    │   │     └───┘  └───┘    └───┘  └──┘
 └────────┘    └─┘    └───┘
```

### 1.4 T-Shape (T字型) — 8 vertices
```
 V0────────────────V1
 │                  │
 V7──V6      V3──V2
      │      │
      V5────V4
```
- **Vertices**: 8 (6 convex + 2 reflex at V6 and V3)
- **Walls**: 8
- **Reflex corners**: 2 (where the stem meets the top bar)
- **Math check**:
  - Top bar width > stem width
  - Stem is centered or offset from the bar
  - Sum rightward = sum leftward; sum downward = sum upward

### 1.5 Cross/Plus Shape (十字型) — 12 vertices
```
      ┌──┐
      │  │
 ┌────┘  └────┐
 │            │
 └────┐  ┌────┘
      │  │
      └──┘
```
- **Vertices**: 12 (8 convex + 4 reflex)
- **Walls**: 12
- **Reflex corners**: 4

### 1.6 Irregular / Angled Shapes
- Non-orthogonal buildings with walls at angles ≠ 90°
- Each wall gets its own angle; vertex positions define the shape
- AI must extract actual vertex positions, not approximate regular polygons

---

## 2. Japanese XY Axis Notation System (通り芯記号)

### Convention:
- **X axis** = shorter dimension of the building (typically width/奥行き)
- **Y axis** = longer dimension of the building (typically length/間口)
- Grid lines are labeled sequentially: X1, X2, X3... and Y1, Y2, Y3...
- The numbering follows the structural grid from left to right (X) and bottom to top (Y)

### Mapping to Cardinal Directions:
For a standard orientation (north at top):
- **North/South walls** run along Y axis → labeled Y1, Y2, ...
- **East/West walls** run along X axis → labeled X1, X2, ...

### Example — Rectangle:
```
     Y1          Y2
 X1 ┌──────────────┐ X1
    │              │
 X2 └──────────────┘ X2
     Y1          Y2

 Walls: North(Y)=15000mm, East(X)=8000mm, South(Y)=15000mm, West(X)=8000mm
 Grid:  X1→X2 = 8000mm (depth), Y1→Y2 = 15000mm (frontage)
```

### Example — L-Shape:
```
     Y1    Y2    Y3
 X1 ┌──────┐         X1
    │      │
 X2 │      └──────┐  X2
    │              │
 X3 └──────────────┘  X3
     Y1    Y2    Y3

 Grid lines:
  X1→X2 = 4000mm (upper wing depth)
  X2→X3 = 6000mm (lower wing depth)
  Y1→Y2 = 8000mm (wing width)
  Y2→Y3 = 7000mm (extension width)

 Walls: V0→V1=8000(Y), V1→V2=4000(X), V2→V3=7000(Y),
        V3→V4=10000(X), V4→V5=15000(Y), V5→V0=6000(X)
```

### Grid Line Extraction from Drawings:
1. Look for circled numbers/letters at edges of plan (通り芯符号)
2. Horizontal grid lines → X1, X2, X3 (numbered top to bottom)
3. Vertical grid lines → Y1, Y2, Y3 (numbered left to right)
4. Dimension between grid lines = structural bay size
5. Total wall length = sum of bays along that wall

---

## 3. Scaffold Corner Rules

### 3.1 Corner Geometry (300mm Overrun Rule)
At every corner where two walls meet at ~90°:
```
                    300mm overrun
                    ←──→
 Wall A ═══════════╤════╕
                   │    │ 600mm corner span
 Wall B            ╧════╛
 (starts here)     ↑
                   shared corner post
```

- Last span of Wall A overruns past the building corner by **300mm**
- A **600mm corner span** connects the overrun to the shared corner post
- Wall B starts from the same shared corner post
- Net: each wall's total span = wallLength + 300mm (absorbed in the corner budget)

### 3.2 Span Layout with Corner (`fitSpansToWallLengthWithCorner`)
For a closed polygon (≥2 walls):
```
wallLength = total wall length (mm)
middleLength = wallLength - 2×600 - 300 = wallLength - 1500
spans = [600, ...fitMiddle(middleLength)..., 600]
```

### 3.3 Corner Connection Types

#### a) L-Shaped Corner (90° convex) — Full Closure
- Two yokoji pipes connecting wall A end posts to wall B start posts
- Corner deck (quad shape) fills the gap
- Habaki bar along the inner edge
- This is the standard corner for rectangles and L/U/T shapes

#### b) Reflex Corner (270° concave) — Inner Corner
- Same yokoji + deck connection but the scaffold wraps inward
- Normal direction flips at reflex corners
- Deck fills the inner corner gap

#### c) Non-90° Corner (obtuse/acute) — Pattanko
- When |cos(angle)| >= 0.35 (not a clean 90°)
- Small filler planks (pattanko) bridge the gap
- Count: 2 per corner per level

### 3.4 Corner Closure Math
For an L-shaped corner between Wall A (end) and Wall B (start):
```
Wall A last 2 posts:  postA[-2], postA[-1]
Wall B first 2 posts: postB[0],  postB[1]

Yokoji pipes:
  pipe(postA[-2] → postB[0])   — outer row
  pipe(postA[-1] → postB[1])   — inner row
  pipe(postA[-2] → postA[-1])  — cross bar

Deck: quad(postA[-2], postB[0], postB[1], postA[-1])
Habaki: bar(postA[-2], postA[-1])
```

---

## 4. AI Extraction Rules (Prevention of Hallucination)

### 4.1 Shape Detection Validation
The AI MUST validate its extraction against these mathematical invariants:

#### Rectangle (4 vertices):
```
ASSERT: wallLengthsMm.length == 4
ASSERT: wallLengthsMm[0] ≈ wallLengthsMm[2]  (opposite sides equal)
ASSERT: wallLengthsMm[1] ≈ wallLengthsMm[3]  (opposite sides equal)
ASSERT: perimeter = 2 × (length + width)
```

#### L-Shape (6 vertices):
```
ASSERT: wallLengthsMm.length == 6
For orthogonal L (all 90° angles):
  Horizontal edges sum: rightward = leftward
  Vertical edges sum: downward = upward
  Specifically: short_top + notch_horizontal = long_bottom
  And: short_side + notch_vertical = long_side
```

#### U-Shape (8 vertices):
```
ASSERT: wallLengthsMm.length == 8
ASSERT: 2 reflex corners detected
  left_wing_width + courtyard_width + right_wing_width = bottom_width
  left_height = right_height
```

#### T-Shape (8 vertices):
```
ASSERT: wallLengthsMm.length == 8
ASSERT: 2 reflex corners
  top_bar_width > stem_width
  reflex_offset_left + stem_width + reflex_offset_right = top_bar_width
```

### 4.2 Terrace/Balcony Detection
- Open terraces (no structural walls on outer edge) → EXCLUDE from polygon
- Enclosed wings with structural walls → INCLUDE in polygon
- Terrace dimensions → add as obstacle `type: "balcony"`, not as wall
- Multi-story: if upper floors extend OVER a terrace, use full building dimension

### 4.3 Door Detection
- Floor plans: look for arc (quarter-circle swing) on EXTERIOR walls
- Each exterior door → obstacle `{ type: "door", wallIndex, positionMm, widthMm }`
- Interior doors between rooms → IGNORE
- Sliding doors on exterior walls → count as doors

### 4.4 3D/BIM View Rules
- Perspective illusion: rectangular box from 3/4 angle shows hexagonal silhouette → still 4 vertices
- Count floors for height: typical 3000-4000mm per story
- L/U/T shape visible from angle: reconstruct top-down footprint mentally
- Stepped buildings: use massingTiers for setback upper floors

### 4.5 IFC/BIM File Rules
- Extract ground floor slab outline as footprint
- Wall heights from storey data
- Grid lines from IfcGrid entities → XY notation
- Structural columns → obstacles of type "pillar"

### 4.6 DXF/CAD Rules
- Largest closed polyline by area = building footprint
- Dimension text entities → wallLengthsMm
- Grid circles at intersections → column positions
- Layer names may indicate structural vs. non-structural

---

## 5. Wall Counting Rules (Anti-Hallucination)

### Rule 1: Vertex Count = Wall Count
Every closed polygon has exactly N walls for N vertices. No exceptions.

### Rule 2: One Wall Per Straight Edge
A straight wall is ONE edge, even if:
- The roofline height changes along it (use wallHeightsMm instead)
- A structural grid line crosses it
- Windows or doors are on it

### Rule 3: Orthogonal Closure Check
For buildings with all 90° corners:
```
Sum of all rightward edge lengths = Sum of all leftward edge lengths
Sum of all downward edge lengths = Sum of all upward edge lengths
```
If these don't balance, a dimension was read incorrectly.

### Rule 4: Minimum/Maximum Vertex Count
- Rectangle: exactly 4
- L-shape: exactly 6
- U-shape: exactly 8
- T-shape: exactly 8
- Cross: exactly 12
- If you have an odd number of vertices for an orthogonal building, something is wrong

### Rule 5: Reflex Corner Count
For orthogonal buildings with N vertices:
- Expected reflex corners = (N - 4) / 2
- Rectangle (4): 0 reflex
- L-shape (6): 1 reflex
- U-shape (8): 2 reflex
- T-shape (8): 2 reflex
- Cross (12): 4 reflex

---

## 6. Scaffold Layout Per Shape

### 6.1 Rectangle — 4 walls, 4 corners
```
All walls: fitSpansToWallLengthWithCorner(wallLengthMm)
All corners: L-shaped (yokoji + deck)
Pattanko: 0
Total posts: sum of (spans_per_wall + 1) for each wall, minus shared corners
Base yokoji: N×2 (span dir) + (N+1) (width dir) per wall
```

### 6.2 L-Shape — 6 walls, 6 corners
```
All walls: fitSpansToWallLengthWithCorner(wallLengthMm)
5 convex corners: L-shaped (yokoji + deck)
1 reflex corner: L-shaped but scaffold wraps inward
Pattanko: 0 (all 90°)
Special: reflex corner needs inward-facing yokoji connection
```

### 6.3 U-Shape — 8 walls, 8 corners
```
All walls: fitSpansToWallLengthWithCorner(wallLengthMm)
6 convex corners: L-shaped
2 reflex corners: inward-facing scaffold
Pattanko: 0 (all 90°)
```

### 6.4 T-Shape — 8 walls, 8 corners
```
All walls: fitSpansToWallLengthWithCorner(wallLengthMm)
6 convex corners: L-shaped
2 reflex corners: where stem meets bar
Pattanko: 0 (all 90°)
```

---

## 7. 3D View Corner Closure Requirements

For every pair of adjacent walls in the closed polygon:
1. Detect corner type (convex vs reflex, L-shaped vs obtuse)
2. Connect wall A last posts to wall B first posts with yokoji pipes
3. Fill gap with corner deck (extruded quad)
4. Add habaki bars at inner edges
5. Repeat for every scaffold level

The 3D view MUST:
- Close all corners (no gaps between adjacent wall scaffold runs)
- Handle reflex corners (scaffold on inside of building)
- Support all shape types (rectangle, L, U, T, cross, irregular)
- Apply 300mm overrun at each corner

---

## 8. Common AI Extraction Errors and Fixes

| Error | Symptom | Fix |
|-------|---------|-----|
| Perspective silhouette traced | 6 vertices for rectangle | Reconstruct top-down footprint: 4 vertices |
| Interior walls included | Too many vertices (>12) | Only trace EXTERIOR structural walls |
| Terrace included in polygon | Extra wing without structural walls | Exclude open terraces, add as obstacle |
| Grid lines traced | Many vertices along straight wall | One vertex per direction change only |
| Heights split into extra walls | 8 vertices for L-shape | Keep 6 vertices, use wallHeightsMm |
| Missing reflex corner | L-shape drawn as rectangle | Must include concave corner vertex |
| Wrong dimension assignment | Wall length doesn't match drawing | Use parallel outermost dimension line |
| Missing doors | No obstacle entries | Look for arc swing lines on exterior walls |
| Mixed units | Some mm, some m | Convert ALL to mm |
