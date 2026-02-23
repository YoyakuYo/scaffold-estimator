-- ============================================================
-- Migration 015: Add scaffold type support (kusabi + wakugumi)
-- ============================================================

-- 1. Add scaffold_type column (default 'kusabi' for backward compatibility)
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS scaffold_type VARCHAR(20) NOT NULL DEFAULT 'kusabi';

-- 2. Add wakugumi-specific columns
-- Frame size (建枠サイズ): 1700, 1800, 1900mm — determines level height for wakugumi
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS frame_size_mm INT DEFAULT 1700;

-- Habaki count per span: 1 or 2 (user-selectable for wakugumi, always 2 for kusabi)
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS habaki_count_per_span INT DEFAULT 2;

-- End stopper type: 'nuno' (布材, horizontal bars) or 'frame' (枠, frame stopper)
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS end_stopper_type VARCHAR(10) DEFAULT 'nuno';

-- 3. Index on scaffold_type for filtering
CREATE INDEX IF NOT EXISTS idx_scaffold_config_type ON scaffold_configurations(scaffold_type);

-- 4. Seed wakugumi materials into scaffold_materials table
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, sort_order) VALUES
-- 建枠 (Waku / Frame Posts)
('WAKU-FRAME-1700', '建枠 1700mm', 'Frame 1700mm', 'post', 'wakugumi', '1700mm', '枠', 1700, 11.2, 1),
('WAKU-FRAME-1800', '建枠 1800mm', 'Frame 1800mm', 'post', 'wakugumi', '1800mm', '枠', 1800, 11.8, 2),
('WAKU-FRAME-1900', '建枠 1900mm', 'Frame 1900mm', 'post', 'wakugumi', '1900mm', '枠', 1900, 12.4, 3),
-- ブレス (Brace)
('WAKU-BRACE-610',  'ブレス 610mm',  'Brace 610mm',  'brace', 'wakugumi', '610mm',  '本', 610,  NULL, 10),
('WAKU-BRACE-914',  'ブレス 914mm',  'Brace 914mm',  'brace', 'wakugumi', '914mm',  '本', 914,  NULL, 11),
('WAKU-BRACE-1219', 'ブレス 1219mm', 'Brace 1219mm', 'brace', 'wakugumi', '1219mm', '本', 1219, NULL, 12),
('WAKU-BRACE-1524', 'ブレス 1524mm', 'Brace 1524mm', 'brace', 'wakugumi', '1524mm', '本', 1524, NULL, 13),
('WAKU-BRACE-1829', 'ブレス 1829mm', 'Brace 1829mm', 'brace', 'wakugumi', '1829mm', '本', 1829, NULL, 14),
-- 下桟 (Shitasan / Bottom Horizontal)
('WAKU-SHITASAN-610',  '下桟 610mm',  'Bottom Bar 610mm',  'horizontal', 'wakugumi', '610mm',  '本', 610,  NULL, 20),
('WAKU-SHITASAN-914',  '下桟 914mm',  'Bottom Bar 914mm',  'horizontal', 'wakugumi', '914mm',  '本', 914,  NULL, 21),
('WAKU-SHITASAN-1219', '下桟 1219mm', 'Bottom Bar 1219mm', 'horizontal', 'wakugumi', '1219mm', '本', 1219, NULL, 22),
('WAKU-SHITASAN-1524', '下桟 1524mm', 'Bottom Bar 1524mm', 'horizontal', 'wakugumi', '1524mm', '本', 1524, NULL, 23),
('WAKU-SHITASAN-1829', '下桟 1829mm', 'Bottom Bar 1829mm', 'horizontal', 'wakugumi', '1829mm', '本', 1829, NULL, 24),
-- 踏板 (Plank) — same widths as kusabi
('WAKU-ANCHI-500x610',  '踏板 500×610mm',  'Plank 500×610mm',  'plank', 'wakugumi', '500×610',  '枚', 610,  NULL, 30),
('WAKU-ANCHI-500x914',  '踏板 500×914mm',  'Plank 500×914mm',  'plank', 'wakugumi', '500×914',  '枚', 914,  NULL, 31),
('WAKU-ANCHI-500x1219', '踏板 500×1219mm', 'Plank 500×1219mm', 'plank', 'wakugumi', '500×1219', '枚', 1219, NULL, 32),
('WAKU-ANCHI-500x1524', '踏板 500×1524mm', 'Plank 500×1524mm', 'plank', 'wakugumi', '500×1524', '枚', 1524, NULL, 33),
('WAKU-ANCHI-500x1829', '踏板 500×1829mm', 'Plank 500×1829mm', 'plank', 'wakugumi', '500×1829', '枚', 1829, NULL, 34),
('WAKU-ANCHI-240x610',  '踏板(半幅) 240×610mm',  'Half Plank 240×610mm',  'plank', 'wakugumi', '240×610',  '枚', 610,  NULL, 35),
('WAKU-ANCHI-240x914',  '踏板(半幅) 240×914mm',  'Half Plank 240×914mm',  'plank', 'wakugumi', '240×914',  '枚', 914,  NULL, 36),
('WAKU-ANCHI-240x1219', '踏板(半幅) 240×1219mm', 'Half Plank 240×1219mm', 'plank', 'wakugumi', '240×1219', '枚', 1219, NULL, 37),
('WAKU-ANCHI-240x1524', '踏板(半幅) 240×1524mm', 'Half Plank 240×1524mm', 'plank', 'wakugumi', '240×1524', '枚', 1524, NULL, 38),
('WAKU-ANCHI-240x1829', '踏板(半幅) 240×1829mm', 'Half Plank 240×1829mm', 'plank', 'wakugumi', '240×1829', '枚', 1829, NULL, 39),
-- 巾木 (Habaki / Toe Board)
('WAKU-HABAKI-610',  '巾木 610mm',  'Toe Board 610mm',  'toe_board', 'wakugumi', '610mm',  '枚', 610,  NULL, 40),
('WAKU-HABAKI-914',  '巾木 914mm',  'Toe Board 914mm',  'toe_board', 'wakugumi', '914mm',  '枚', 914,  NULL, 41),
('WAKU-HABAKI-1219', '巾木 1219mm', 'Toe Board 1219mm', 'toe_board', 'wakugumi', '1219mm', '枚', 1219, NULL, 42),
('WAKU-HABAKI-1524', '巾木 1524mm', 'Toe Board 1524mm', 'toe_board', 'wakugumi', '1524mm', '枚', 1524, NULL, 43),
('WAKU-HABAKI-1829', '巾木 1829mm', 'Toe Board 1829mm', 'toe_board', 'wakugumi', '1829mm', '枚', 1829, NULL, 44),
-- 端部布材 (End Stopper - Nuno type, size = scaffold width)
('WAKU-STOPPER-600',  '端部布材 600mm',  'End Stopper 600mm',  'stopper', 'wakugumi', '600mm',  '本', 600,  NULL, 50),
('WAKU-STOPPER-900',  '端部布材 900mm',  'End Stopper 900mm',  'stopper', 'wakugumi', '900mm',  '本', 900,  NULL, 51),
('WAKU-STOPPER-1200', '端部布材 1200mm', 'End Stopper 1200mm', 'stopper', 'wakugumi', '1200mm', '本', 1200, NULL, 52),
-- 端部枠 (End Stopper - Frame type, count only)
('WAKU-END-FRAME', '妻側枠', 'End Frame Stopper', 'stopper_frame', 'wakugumi', '枠タイプ', '枠', NULL, NULL, 55),
-- 階段セット
('WAKU-STAIR-SET', '階段セット', 'Stair Set', 'stairway', 'wakugumi', '1セット', 'セット', NULL, NULL, 60),
-- ジャッキベース (shared, already exists as SHARED-JB-*)
-- 根がらみ (Negarami) — uses shitasan sizes
-- 壁つなぎ (Wall Tie) — shared
-- メッシュシート (Mesh) — shared
('WAKU-NEGARAMI-610',  '根がらみ 610mm',  'Base Stabilizer 610mm',  'negarami', 'wakugumi', '610mm',  '本', 610,  NULL, 70),
('WAKU-NEGARAMI-914',  '根がらみ 914mm',  'Base Stabilizer 914mm',  'negarami', 'wakugumi', '914mm',  '本', 914,  NULL, 71),
('WAKU-NEGARAMI-1219', '根がらみ 1219mm', 'Base Stabilizer 1219mm', 'negarami', 'wakugumi', '1219mm', '本', 1219, NULL, 72),
('WAKU-NEGARAMI-1524', '根がらみ 1524mm', 'Base Stabilizer 1524mm', 'negarami', 'wakugumi', '1524mm', '本', 1524, NULL, 73),
('WAKU-NEGARAMI-1829', '根がらみ 1829mm', 'Base Stabilizer 1829mm', 'negarami', 'wakugumi', '1829mm', '本', 1829, NULL, 74)
ON CONFLICT (code) DO NOTHING;
