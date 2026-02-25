# Scaffold Material Tables — Kusabi & Wakugumi

Reference for all material **tables** (sources of truth), **roles**, and **sizes** used in the codebase for くさび式足場 (Kusabi) and 枠組足場 (Wakugumi).

---

## 1. Database table: `scaffold_materials`

**File:** `backend/src/modules/scaffold-config/scaffold-material.entity.ts`  
**Migration:** `supabase-migrations/012_scaffold_materials_and_config_updates.sql`

Single table for all scaffold types. Columns include: `code`, `name_jp`, `name_en`, `category`, `scaffold_type`, `size_spec`, `unit`, `standard_length_mm`, `standard_width_mm`, `weight_kg`, `rental_price_monthly`, `pipe_diameter_mm`, etc.

- **Kusabi:** Seeded by `ScaffoldConfigService.getDefaultMaterials()` / `seedMaterials()` (see section 2).
- **Wakugumi:** Calculator emits `WAKU-*` codes; matching rows in `scaffold_materials` can be added for pricing. No wakugumi seed in code today; migration 012 had `frame` type (legacy), 014 cleared frame/next_gen.

---

## 2. Kusabi (くさび式足場) — Rules & materials

**Rules/catalog:** `backend/src/modules/scaffold-config/scaffold-rules.ts`  
**Calculator:** `backend/src/modules/scaffold-config/scaffold-calculator.service.ts`  
**Seed (DB):** `backend/src/modules/scaffold-config/scaffold-config.service.ts` → `getDefaultMaterials()`

### 2.1 Rule/catalog definitions (sizes used in calculation)

| Role | Constant / catalog | Sizes (mm) | Role in calculation |
|------|-------------------|------------|----------------------|
| **Scaffold width** | `SCAFFOLD_WIDTH_OPTIONS` | 600, 900, 1200 | Distance front↔back. |
| **Posts (支柱)** | `POST_CATALOG` / `POST_HEIGHTS` | 225, 450, 600, 900, 1350, 1800, 2700, 3600 | MA series φ48.6mm. |
| **Main tateji** | `MAIN_TATEJI_OPTIONS` | 1800, 2700, 3600 | User choice; stacking post per level. |
| **Top guard** | `TOP_GUARD_OPTIONS` | 900, 1350, 1800 | Post above top plank. |
| **Span sizes** | `SPAN_SIZES` / `SPAN_OPTIONS` | 600, 900, 1200, 1500, 1800 | Standard bay length. |
| **Nuno (布材)** | `NUNO_SIZES` | 200, 300, 600, 900, 1200, 1500, 1800 | Tesuri, stopper, negarami, bearer. |
| **Anchi (踏板)** | `ANCHI_WIDTHS`, `ANCHI_LENGTHS`, `ANCHI_LAYOUT_BY_WIDTH` | Widths: 240, 500. Lengths: 600–1800 (match span) | Full/half plank by scaffold width (600→1×500; 900→1×500+1×240; 1200→2×500). |
| **Brace (ブレス)** | `BRACE_SIZES` | 600, 900, 1200, 1500, 1800 | X-brace, outer face only, 1 per span per level. |
| **Habaki (巾木)** | `HABAKI_SIZES` | 600, 900, 1200, 1500, 1800 | Toe board, front+back, 2 per span per level. |
| **Jack base** | `JACK_BASE` | 0–300 (adjustable) | Count only, no size in BOM. |
| **Level height** | `LEVEL_HEIGHT_MM` | 1800 (fixed) | One level = 1800 mm. |
| **Stair** | `STAIR_SET`, `STAIR_ACCESS_OPTIONS` | 1–4 箇所 | 1 set = kaidan + 2 tesuri + guard; replaces 1 anchi per level per access. |

### 2.2 DB seed codes (scaffold_config.service → getDefaultMaterials)

| Code pattern | Name (JP) | Category | Sizes / spec | Unit |
|--------------|-----------|----------|--------------|------|
| `KUSABI-JB` | ジャッキベース | jack_base | 調整式 | 本 |
| `KUSABI-MA-18` / `MA-27` / `MA-36` | 支柱 MA-* | post | 1800, 2700, 3600 mm | 本 |
| `KUSABI-MA-9-TOP` / `MA-13-TOP` / `MA-18-TOP` | 上部支柱 MA-* | post | 900, 1350, 1800 mm | 本 |
| `KUSABI-BRACE-{size}` | ブレス | brace | 600, 900, 1200, 1500, 1800 | 本 |
| `KUSABI-TESURI-{size}` | 手摺 | handrail | 600, 900, 1200, 1500, 1800 | 本 |
| `KUSABI-STOPPER-{size}` | 端部手摺 | handrail | 600, 900, 1200 | 本 |
| `KUSABI-NEGR-{size}` | 根がらみ | horizontal | 600, 900, 1200, 1500, 1800 | 本 |
| `KUSABI-BEARER-{size}` | 踏板受け | horizontal | 600, 900, 1200 | 本 |
| `KUSABI-ANCHI-500x{span}` | 踏板 | plank | 500×600, 500×900, …, 500×1800 | 枚 |
| `KUSABI-ANCHI-HALF-240x{span}` | 踏板 (半幅) | plank | 240×600, …, 240×1800 | 枚 |
| `KUSABI-HABAKI-{size}` | 巾木 | toe_board | 600, 900, 1200, 1500, 1800 | 枚 |
| `KUSABI-STAIR-SET` | 階段セット | stairway | 1階段+2手摺+1ガード | セット |
| `PATTANKO` | パッタンコ (PATTANKO) | 踏板 (in summary) | 角部用 | 枚 |

*(PATTANKO is added in calculator summary only; no row in getDefaultMaterials — can be added to DB for pricing.)*

---

## 3. Wakugumi (枠組足場) — Rules & materials

**Rules/catalog:** `backend/src/modules/scaffold-config/scaffold-rules-wakugumi.ts`  
**Calculator:** `backend/src/modules/scaffold-config/scaffold-calculator-wakugumi.service.ts`  
**DB:** No dedicated wakugumi seed in service; calculator uses `WAKU-*` codes (pricing from `scaffold_materials` if rows exist).

### 3.1 Rule/catalog definitions

| Role | Constant | Sizes (mm) | Role in calculation |
|------|----------|------------|----------------------|
| **Frame size (建枠)** | `WAKUGUMI_FRAME_SIZE_OPTIONS` | 1700, 1800, 1900 | Level height = frame size. |
| **Span sizes** | `WAKUGUMI_SPAN_SIZES` / `WAKUGUMI_SPAN_OPTIONS` | 610, 914, 1219, 1524, 1829 | Imperial-derived. |
| **Scaffold width** | `WAKUGUMI_SCAFFOLD_WIDTH_OPTIONS` | 600, 900, 1200 | Same as kusabi. |
| **Habaki count** | `WAKUGUMI_HABAKI_COUNT_OPTIONS` | 1 or 2 per span | User choice. |
| **End stopper** | `WAKUGUMI_END_STOPPER_TYPE_OPTIONS` | nuno / frame | 布材 or 枠. |
| **Anchi layout** | `WAKUGUMI_ANCHI_LAYOUT_BY_WIDTH` | Same as kusabi (500/240 by width) | 600→1×500; 900→1×500+1×240; 1200→2×500. |
| **Brace** | `WAKUGUMI_BRACE_SIZES` | 610, 914, 1219, 1524, 1829 | 2 per span per level (both faces). |
| **Shitasan (下桟)** | `WAKUGUMI_SHITASAN_SIZES` | 610, 914, 1219, 1524, 1829 | Bottom horizontal, both faces. |
| **Habaki** | `WAKUGUMI_HABAKI_SIZES` | 610, 914, 1219, 1524, 1829 | 1 or 2 per span. |
| **Jack base** | `WAKUGUMI_JACK_BASE` | 0–300 | Same as kusabi. |
| **Stair** | `WAKUGUMI_STAIR_SET`, `WAKUGUMI_STAIR_ACCESS_OPTIONS` | 1–4 箇所 | Same idea as kusabi. |

### 3.2 Material codes emitted by wakugumi calculator

| Code pattern | Name (conceptual) | Category | Sizes / spec | Unit |
|--------------|-------------------|----------|--------------|------|
| `SHARED-JB-400` | ジャッキベース | jack_base | 400 mm (or adjustable) | 本 |
| `WAKU-FRAME-{frameSizeMm}` | 建枠 | post | 1700, 1800, 1900 | 本 |
| `WAKU-BRACE-{spanSizeMm}` | ブレス | brace | 610, 914, 1219, 1524, 1829 | 本 |
| `WAKU-SHITASAN-{spanSizeMm}` | 下桟 | horizontal | 610, 914, 1219, 1524, 1829 | 本 |
| `WAKU-STOPPER-{widthMm}` | 端部布材 | handrail | 600, 900, 1200 | 本 |
| `WAKU-END-FRAME` | 妻側枠 (end frame) | — | count only | 本 or セット |
| `WAKU-ANCHI-500x{spanSizeMm}` | 踏板 | plank | 500×610, …, 500×1829 | 枚 |
| `WAKU-ANCHI-240x{spanSizeMm}` | 踏板 (半幅) | plank | 240×… | 枚 |
| `WAKU-HABAKI-{spanSizeMm}` | 巾木 | toe_board | 610, 914, 1219, 1524, 1829 | 枚 |
| `WAKU-STAIR-SET` | 階段セット | stairway | 1 set | セット |
| `PATTANKO` | パッタンコ (PATTANKO) | 踏板 | 角部用 | 枚 |

---

## 4. Other tables that reference materials

| Table / file | Role |
|--------------|------|
| **cost_master_data** (`supabase-migrations/109_cost_master_data.sql`) | Cost rates by category (basic_charge, transport, damage, etc.), not material catalog. |
| **Quotation / quotation_cost_item** | Store selected materials and quantities per quotation; reference material codes. |
| **price-table-parser.service.ts** | Parses Excel price tables; can set `materialCode` for rows. |

---

## 5. Summary

- **Single material table:** `scaffold_materials` (entity: `ScaffoldMaterial`).
- **Kusabi:** Sizes and roles are defined in `scaffold-rules.ts`; BOM codes in `scaffold-calculator.service.ts`; DB seed (and thus codes/sizes) in `scaffold-config.service.ts` → `getDefaultMaterials()`.
- **Wakugumi:** Sizes and roles in `scaffold-rules-wakugumi.ts`; BOM codes in `scaffold-calculator-wakugumi.service.ts`. No wakugumi seed in code; add `scaffold_type = 'wakugumi'` rows to `scaffold_materials` with `WAKU-*` / `PATTANKO` codes to enable pricing.
- **PATTANKO:** Included in both calculators’ summary (quantity = corners × 2 × levels); code `PATTANKO`; can be added to `scaffold_materials` for pricing.
