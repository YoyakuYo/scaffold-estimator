# Fix Report: Exterior-Only Scaffold Filter for Stepped Buildings

**Date:** 2026-03-22
**Commit:** `56441c0` — `fix(3d): skip terrace-facing scaffold using outward-normal direction check`
**File Changed:** `frontend/app/scaffold/[configId]/scaffold-3d-view.tsx`
**Lines:** 1504–1570 (the `wallSkipFlags` block only)
**Change Size:** 36 insertions, 24 deletions

---

## The Problem

When a building has a stepped/setback shape (段状建物), the 3D scaffold view rendered scaffold on ALL upper-tier walls — including walls that face the terrace/roof of the tier below. Workers can stand on the terrace to access those walls, so scaffold there is unnecessary.

Visual symptom: a "staircase" of scaffold climbing up each step of the building.

---

## The Bug (What Was Wrong)

The exterior filter block (lines 1504–1558) had one critical logic error at **line 1534**:

```typescript
if (pointInPolygonXZ(mid, lv)) continue;
```

### Why This Was Broken

- `mid` = midpoint of the upper-tier wall edge
- `lv` = lower-tier polygon vertices (the building footprint below)
- For a stepped building, the upper tier is **entirely inside** the lower tier's footprint
- So `pointInPolygonXZ(mid, lv)` returned `true` for **every** upper-tier wall
- `continue` skipped the rest of the filter logic (proximity/height checks)
- Result: **no upper-tier wall was ever filtered out**

The code below line 1534 (proximity check, scaffold strip width, height comparison) was correct in concept but **unreachable** because line 1534 always bailed early.

---

## The Fix (What Was Changed)

Replaced the broken `pointInPolygonXZ(mid, lv) → continue` approach with a **direction-aware** test. The new logic asks: "Which direction does the scaffold face? If it faces the terrace, skip it."

### The Three Checks (In Order)

#### Check 1: Co-Edge Safety

```typescript
let isCoEdge = false;
for (let gi = 0; gi < lv.length; gi++) {
  if (pointToSegmentDistXZ(mid, lv[gi], lv[(gi + 1) % lv.length]) < CO_EDGE_THRESHOLD) {
    isCoEdge = true;
    break;
  }
}
if (isCoEdge) continue;
```

**Purpose:** If the upper-tier wall sits on the same edge as a lower-tier wall (within 0.15m), it's a vertical continuation — always keep it, never skip.

**Example:** The right side of a building that goes straight up from ground to roof. The upper tier's right wall is co-edge with the lower tier's right wall.

#### Check 2: Compute Outward Normal

```typescript
const edx = p2.x - p1.x;
const edz = p2.z - p1.z;
const eLen = Math.hypot(edx, edz);
if (eLen < 1e-6) continue;
let onx = tSign * (-edz / eLen);
let onz = tSign * (edx / eLen);

if (tv.length >= 3) {
  const probe: PointXZ = { x: mid.x + onx * 0.15, z: mid.z + onz * 0.15 };
  if (pointInPolygonXZ(probe, tv)) { onx = -onx; onz = -onz; }
}
```

**Purpose:** Determine which direction the scaffold would face from this wall.

**How it works:**
1. Get perpendicular to the wall edge using `tSign` (polygon winding sign)
2. Probe a point 0.15m in that direction
3. If the probe is inside the upper-tier polygon → normal points inward → flip it
4. After this, `(onx, onz)` reliably points **outward** from the upper tier

**Note:** This is the same technique used by the rendering code at lines 1617–1643 to compute outward normals. Proven logic, just reused here.

#### Check 3: Scaffold Projection Test

```typescript
const scaffoldProbe: PointXZ = {
  x: mid.x + onx * (standoffM + 0.5),
  z: mid.z + onz * (standoffM + 0.5),
};
if (pointInPolygonXZ(scaffoldProbe, lv)) {
  wallSkipFlags[globalIdx] = true;
}
```

**Purpose:** The decisive test. Project a point from the wall midpoint in the scaffold direction (outward from upper tier). If that point lands inside the lower tier's footprint, the scaffold faces the terrace → skip the wall.

**Probe distance:** `standoffM + 0.5` ≈ 0.8m (past the scaffold inner row but within the scaffold strip width).

---

## Decision Table

| Wall Type | Example | Outward Normal | Probe Inside Lower? | Result |
|-----------|---------|---------------|---------------------|--------|
| Terrace-facing | Left wall of upper tier facing the step-back | Points toward terrace | YES → inside | **SKIPPED** |
| Exterior flush | Right wall going straight up | Co-edge check catches it | N/A | **KEPT** |
| Exterior (not flush) | Front/back wall of upper tier | Points away from building | NO → outside | **KEPT** |
| Ground tier (tier 0) | Any base-level wall | Loop starts at tgi=1 | N/A | **ALWAYS KEPT** |
| Single-tier building | Normal building, no steps | `hasTiers` is false | N/A | **FILTER NEVER RUNS** |

---

## What Was NOT Changed

These components were left completely untouched:

- `buildWallScaffold()` — how posts, planks, braces, habaki, end stoppers are rendered
- Polygon vertex computation (`buildFootprintPolygonXZ`)
- Tier decomposition (`tier-wall-decomposer.ts`)
- Wall transformation matrices (3D position/rotation)
- Corner and pattanko logic
- BOM / Excel export / 2D view
- Backend calculation (`scaffold-calculator.service.ts`, `scaffold-rules.ts`)

The fix ONLY sets `wallSkipFlags[i] = true/false`. Walls that pass the filter render identically to before.

---

## Key Variables Reference

| Variable | Location | Meaning |
|----------|----------|---------|
| `wallSkipFlags` | Line 1513 | Boolean array — `true` = don't render this wall |
| `tierGroups` | Line 1155 | Walls partitioned by tier index |
| `tierPolygons` | Built above | Per-tier footprint polygons with vertices |
| `tierPolyData` | Line 1442 | Per-tier normal signs, offset paths, corner flags |
| `groundNormalSign` | Line 1456 | Normal sign of ground-tier polygon winding |
| `standoffM` | Line 1439 | 0.3m — offset from building wall to scaffold inner posts |
| `CO_EDGE_THRESHOLD` | Line 1515 | 0.15m — distance below which a wall is considered co-edge |

---

## If It Breaks Again

### Symptoms and Likely Causes

| Symptom | Likely Cause | Where to Look |
|---------|-------------|---------------|
| Scaffold on terrace again | Filter not skipping walls | Check 3 — probe distance may be too small for large setbacks |
| Exterior walls missing | Co-edge check too aggressive OR normal direction wrong | Check 1 threshold or Check 2 probe/flip logic |
| All upper walls gone | Every wall flagged as skip | Check 3 — `standoffM + 0.5` probe may be too large |
| Works for some buildings, not others | Polygon winding inconsistency | Check 2 — `tSign` or probe-flip may fail for unusual polygon shapes |

### Quick Debug Steps

1. Add `console.log` inside the filter loop:
   ```typescript
   console.log(`Wall ${globalIdx}: coEdge=${isCoEdge}, normal=(${onx.toFixed(2)},${onz.toFixed(2)}), probeInside=${pointInPolygonXZ(scaffoldProbe, lv)}, skip=${wallSkipFlags[globalIdx]}`);
   ```

2. Check the polygon vertices are correct:
   ```typescript
   console.log(`Tier ${tgi} verts:`, tv.map(v => `(${v.x.toFixed(1)},${v.z.toFixed(1)})`));
   console.log(`Lower ${lowerTgi} verts:`, lv.map(v => `(${v.x.toFixed(1)},${v.z.toFixed(1)})`));
   ```

3. Verify normal direction visually — the outward normal should point AWAY from the building center.

### Adjustable Parameters

- `CO_EDGE_THRESHOLD = 0.15` — increase if co-edge walls are being incorrectly skipped (try 0.25)
- `standoffM + 0.5` (probe distance) — decrease if exterior walls are being skipped on buildings with very large setbacks (try `standoffM + 0.3`), increase if terrace walls aren't being caught (try `standoffM + 1.0`)
- `0.15` (normal verification probe) — the distance used to check if the initial normal direction is correct; should be small enough to stay near the wall but large enough to distinguish inside/outside

### Rollback

```bash
git revert 56441c0
```

This cleanly undoes the fix and restores the previous behavior.
