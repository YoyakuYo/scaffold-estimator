# Plan: Maximum 3D Realism + Scan Support

## Current state
- **3D type:** Procedural solid geometry (Three.js): cylinders for tubes, boxes for planks/habaki.
- **Materials:** `MeshStandardMaterial` only (flat colors, metalness/roughness).
- **Export:** PDF (screenshot), glTF (GLB), STL, OBJ (backend) — already usable in BIM/AR viewers.
- **No QR:** No way to “scan” to open the result on another device.

---

## Part 1: Maximum realism (phased)

### Phase 1 — PBR + textures (high impact, moderate effort)
- **Tubes (posts, jacks, braces, rails):**
  - Add **image texture** for galvanised steel (or use tiled seamless metal from public domain).
  - Use **MeshStandardMaterial** with `map` + optional `normalMap` and `roughnessMap` (or single metal texture with roughness in alpha).
  - Keep current geometry (cylinders); no need for hollow yet.
- **Planks / habaki:**
  - Add **wood or wood-like texture** (tiled) for anchi and habaki.
  - Slight variation in roughness so planks don’t look plastic.
- **Assets:** Add `public/textures/scaffold/` (e.g. `metal_galvanised.jpg`, `plank_wood.jpg`) or use a CDN; document in README.
- **Fallback:** If texture load fails, keep current solid colors (no regression).

**Files:** `frontend/lib/scaffold-3d-components.ts` (restore/enhance `loadScaffoldTextures` to return real textures), `frontend/app/scaffold/[configId]/scaffold-3d-view.tsx` (apply texture materials where components are built).

---

### Phase 2 — Hollow tubes + base plates + coupler hint (CAD-like)
- **Hollow tubes:**
  - Replace solid `CylinderGeometry(r, r, len)` with **tube**: `THREE.CylinderGeometry(outerR, outerR, len, PIPE_SEG, 1, true)` (open-ended) or use `TubeGeometry` with a path, or a custom ring extrusion so the pipe has **wall thickness** (e.g. OD 48.6 mm, thickness ~3 mm).
  - Use same radius as now for outer (e.g. 24 mm); inner radius = outer − 3 mm.
- **Base plates (jacks):**
  - Model a small **disc or square plate** under each jack (already have a box; can switch to a thin cylinder or keep box and add a wider plate mesh below for realism).
- **Couplers:**
  - At joints (post–horizontal, post–brace), add a **small box or cylinder** (darker material) to suggest coupler; no need for full mechanical detail.
- **Constants:** Use real dimensions (e.g. φ48.6 mm OD, 2.8–3.2 mm wall) from scaffold rules; centralise in `frontend/lib/scaffold-3d-components.ts` or a small `scaffold-3d-constants.ts`.

**Files:** `frontend/lib/scaffold-3d-components.ts` (hollow cylinder helper, base plate), `scaffold-3d-view.tsx` (use hollow pipes, add coupler meshes at key joints).

---

### Phase 3 — Plank detail + optional environment
- **Planks:**
  - Slight **thickness variation** and **overhang** (e.g. 25 mm thick, 20 mm overhang beyond ledger) so they don’t look like flat cards.
  - Optional **normal map** for wood grain.
- **Environment (optional):**
  - Simple **ground plane** with a subtle texture or gradient; optional **sky** (gradient or env map) so reflections on metal look more realistic.
  - Keep performance in check (no heavy env map if it hurts mobile).

**Files:** `scaffold-3d-components.ts` (plank geometry), `scaffold-3d-view.tsx` (ground/sky if desired).

---

## Part 2: Scan support

### 2.1 Scan to open (QR code) — ✅ implemented
- **Feature:** On the scaffold result page, a “Scan / Share” button in the header that opens a modal with a **QR code** encoding the **current result URL** (including path and query, e.g. `?tab=3d`).
- **Use case:** Site supervisor scans QR with phone → opens same result on mobile (view 3D, table, export).
- **Implementation:** `qrcode.react` (QRCodeSVG), modal with backdrop; i18n: `result.scanShare`, `result.scanToOpen`, `result.scanClose`.
- **Where:** Result page header, next to “Download BOM” and “Export Excel”.

### 2.2 Scan / use 3D model elsewhere (already supported)
- **glTF (GLB):** Export is already there; usable in BIM viewers, AR apps (e.g. iOS AR Quick Look), and 3D tools. Document in UI: “Download glTF to view in AR or 3D apps.”
- **STL:** For 3D print or other CAD; keep as is.
- **Optional:** Add a “Share / Scan” panel that groups:
  - QR code (link to result),
  - Short links to “Download glTF” and “Download STL” so “scan” also means “get the 3D file to scan in an AR app.”

---

## Implementation order (recommended)
1. **QR + “Scan / Share” UI** — immediate value; no 3D pipeline change.
2. **Phase 1 (textures/PBR)** — biggest visual gain for effort.
3. **Phase 2 (hollow tubes, base plates, couplers)** — structural realism.
4. **Phase 3 (plank detail, environment)** — polish; can be skipped or done later.

---

## Dependencies (optional)
- **QR:** `qrcode.react` (or `qrcode` + canvas) in `frontend`.
- **Textures:** None (use image files in `public/` or data URIs); optional normal/roughness maps.
- **Three.js:** Already have `three` and `three-stdlib`; no new deps for hollow cylinder (native `CylinderGeometry` with open ends or custom geometry).

---

## Success criteria
- **Realism:** 3D scaffold looks recognisably like real galvanised tubes and wooden planks; tubes have visible thickness (hollow); base plates and coupler hints visible.
- **Scan:** User can scan a QR to open the result on another device; user can export glTF/STL and use in AR or 3D tools (“scan” the model in an app).
