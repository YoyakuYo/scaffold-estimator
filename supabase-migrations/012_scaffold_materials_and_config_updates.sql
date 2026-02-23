-- ============================================================
-- Migration 012: Material master data + config table updates
-- ============================================================

-- 1. Create scaffold_materials master table
CREATE TABLE IF NOT EXISTS scaffold_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name_jp VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  category VARCHAR(50) NOT NULL,
  scaffold_type VARCHAR(20) NOT NULL,
  size_spec VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT '本',
  standard_length_mm INT,
  standard_width_mm INT,
  weight_kg DECIMAL(8,2),
  rental_price_monthly DECIMAL(12,2) NOT NULL DEFAULT 0,
  purchase_price DECIMAL(12,2),
  bundle_quantity INT,
  pipe_diameter_mm DECIMAL(5,1),
  is_combined BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scaffold_mat_type_cat ON scaffold_materials(scaffold_type, category);

-- 2. Add new columns to scaffold_configurations
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS wall_distance_mm INT DEFAULT 300;
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS plank_width_mm INT DEFAULT 400;
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS post_type VARCHAR(30) DEFAULT 'frame_1700';
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS span_spacing_mm INT DEFAULT 1829;
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS level_height_mm INT DEFAULT 1700;

-- ============================================================
-- 3. Seed: Frame Scaffold Materials (枠組足場)
-- ============================================================

-- 3a. Frame Posts (建枠)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, sort_order) VALUES
('FRAME-POST-900',  '建枠 900mm',  'Frame Post 900mm',  'post', 'frame', '900mm',  '本', 900,  6.5,  1),
('FRAME-POST-1200', '建枠 1200mm', 'Frame Post 1200mm', 'post', 'frame', '1200mm', '本', 1200, 8.2,  2),
('FRAME-POST-1500', '建枠 1500mm', 'Frame Post 1500mm', 'post', 'frame', '1500mm', '本', 1500, 9.8,  3),
('FRAME-POST-1700', '建枠 1700mm', 'Frame Post 1700mm', 'post', 'frame', '1700mm', '本', 1700, 11.2, 4),
('FRAME-POST-1800', '建枠 1800mm', 'Frame Post 1800mm', 'post', 'frame', '1800mm', '本', 1800, 11.8, 5),
('FRAME-POST-1900', '建枠 1900mm', 'Frame Post 1900mm', 'post', 'frame', '1900mm', '本', 1900, 12.4, 6)
ON CONFLICT (code) DO NOTHING;

-- 3b. Frame Horizontal Bars (布枠)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('FRAME-HB-610',  '布枠 610mm',  'Horizontal Bar 610mm',  'horizontal', 'frame', '610mm',  '本', 610,  10),
('FRAME-HB-914',  '布枠 914mm',  'Horizontal Bar 914mm',  'horizontal', 'frame', '914mm',  '本', 914,  11),
('FRAME-HB-1219', '布枠 1219mm', 'Horizontal Bar 1219mm', 'horizontal', 'frame', '1219mm', '本', 1219, 12),
('FRAME-HB-1524', '布枠 1524mm', 'Horizontal Bar 1524mm', 'horizontal', 'frame', '1524mm', '本', 1524, 13),
('FRAME-HB-1829', '布枠 1829mm', 'Horizontal Bar 1829mm', 'horizontal', 'frame', '1829mm', '本', 1829, 14)
ON CONFLICT (code) DO NOTHING;

-- 3c. Frame Braces (筋交い)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('FRAME-BR-914',  '筋交い 914mm',  'Brace 914mm',  'brace', 'frame', '914mm',  '本', 914,  20),
('FRAME-BR-1219', '筋交い 1219mm', 'Brace 1219mm', 'brace', 'frame', '1219mm', '本', 1219, 21),
('FRAME-BR-1524', '筋交い 1524mm', 'Brace 1524mm', 'brace', 'frame', '1524mm', '本', 1524, 22),
('FRAME-BR-1829', '筋交い 1829mm', 'Brace 1829mm', 'brace', 'frame', '1829mm', '本', 1829, 23)
ON CONFLICT (code) DO NOTHING;

-- 3d. Planks (足場板・踏板)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, standard_width_mm, sort_order) VALUES
('FRAME-PL-240x914',  '足場板 240×914mm',  'Plank 240×914mm',  'plank', 'frame', '240×914mm',  '枚', 914,  240, 30),
('FRAME-PL-240x1219', '足場板 240×1219mm', 'Plank 240×1219mm', 'plank', 'frame', '240×1219mm', '枚', 1219, 240, 31),
('FRAME-PL-240x1524', '足場板 240×1524mm', 'Plank 240×1524mm', 'plank', 'frame', '240×1524mm', '枚', 1524, 240, 32),
('FRAME-PL-240x1829', '足場板 240×1829mm', 'Plank 240×1829mm', 'plank', 'frame', '240×1829mm', '枚', 1829, 240, 33),
('FRAME-PL-400x914',  '足場板 400×914mm',  'Plank 400×914mm',  'plank', 'frame', '400×914mm',  '枚', 914,  400, 34),
('FRAME-PL-400x1219', '足場板 400×1219mm', 'Plank 400×1219mm', 'plank', 'frame', '400×1219mm', '枚', 1219, 400, 35),
('FRAME-PL-400x1524', '足場板 400×1524mm', 'Plank 400×1524mm', 'plank', 'frame', '400×1524mm', '枚', 1524, 400, 36),
('FRAME-PL-400x1829', '足場板 400×1829mm', 'Plank 400×1829mm', 'plank', 'frame', '400×1829mm', '枚', 1829, 400, 37),
('FRAME-PL-500x1829', '足場板 500×1829mm', 'Plank 500×1829mm', 'plank', 'frame', '500×1829mm', '枚', 1829, 500, 38)
ON CONFLICT (code) DO NOTHING;

-- 3e. Frame Handrails (手すり)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('FRAME-HR-610',  '手すり 610mm',  'Handrail 610mm',  'handrail', 'frame', '610mm',  '本', 610,  40),
('FRAME-HR-914',  '手すり 914mm',  'Handrail 914mm',  'handrail', 'frame', '914mm',  '本', 914,  41),
('FRAME-HR-1219', '手すり 1219mm', 'Handrail 1219mm', 'handrail', 'frame', '1219mm', '本', 1219, 42),
('FRAME-HR-1524', '手すり 1524mm', 'Handrail 1524mm', 'handrail', 'frame', '1524mm', '本', 1524, 43),
('FRAME-HR-1829', '手すり 1829mm', 'Handrail 1829mm', 'handrail', 'frame', '1829mm', '本', 1829, 44)
ON CONFLICT (code) DO NOTHING;

-- 3f. Toe Boards (幅木)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('FRAME-TB-914',  '幅木 914mm',  'Toe Board 914mm',  'toe_board', 'frame', '914mm',  '枚', 914,  50),
('FRAME-TB-1219', '幅木 1219mm', 'Toe Board 1219mm', 'toe_board', 'frame', '1219mm', '枚', 1219, 51),
('FRAME-TB-1524', '幅木 1524mm', 'Toe Board 1524mm', 'toe_board', 'frame', '1524mm', '枚', 1524, 52),
('FRAME-TB-1829', '幅木 1829mm', 'Toe Board 1829mm', 'toe_board', 'frame', '1829mm', '枚', 1829, 53)
ON CONFLICT (code) DO NOTHING;

-- 3g. Shared Components (shared across scaffold types)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('SHARED-MESH-1800x5100', 'メッシュシート 1800×5100mm', 'Mesh Sheet 1800×5100mm', 'mesh', 'all', '1800×5100mm', '枚', 5100, 60),
('SHARED-JB-400',  'ジャッキベース 400mm',  'Jack Base 400mm',  'jack_base', 'all', '400mm',  '本', 400,  65),
('SHARED-JB-600',  'ジャッキベース 600mm',  'Jack Base 600mm',  'jack_base', 'all', '600mm',  '本', 600,  66),
('SHARED-JB-900',  'ジャッキベース 900mm',  'Jack Base 900mm',  'jack_base', 'all', '900mm',  '本', 900,  67),
('SHARED-WT-1000', '壁つなぎ 1000mm',      'Wall Tie 1000mm',  'wall_tie',  'all', '1000mm', '本', 1000, 70),
('FRAME-STAIR-1700', '階段枠 1700mm',       'Stairway Frame 1700mm', 'stairway', 'frame', '1700mm', 'セット', 1700, 75)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 4. Seed: Single Pipe Scaffold Materials (単管足場)
-- ============================================================

INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, pipe_diameter_mm, sort_order) VALUES
('PIPE-VP-1000', '建地パイプ 1000mm', 'Vertical Pipe 1000mm', 'post',       'single_pipe', 'φ48.6×1000mm', '本', 1000, 2.73, 48.6, 1),
('PIPE-VP-1500', '建地パイプ 1500mm', 'Vertical Pipe 1500mm', 'post',       'single_pipe', 'φ48.6×1500mm', '本', 1500, 4.10, 48.6, 2),
('PIPE-VP-2000', '建地パイプ 2000mm', 'Vertical Pipe 2000mm', 'post',       'single_pipe', 'φ48.6×2000mm', '本', 2000, 5.46, 48.6, 3),
('PIPE-VP-3000', '建地パイプ 3000mm', 'Vertical Pipe 3000mm', 'post',       'single_pipe', 'φ48.6×3000mm', '本', 3000, 8.19, 48.6, 4),
('PIPE-VP-4000', '建地パイプ 4000mm', 'Vertical Pipe 4000mm', 'post',       'single_pipe', 'φ48.6×4000mm', '本', 4000, 10.92, 48.6, 5),
('PIPE-HP-1800', '布パイプ 1800mm',   'Horizontal Pipe 1800mm', 'horizontal', 'single_pipe', 'φ48.6×1800mm', '本', 1800, 4.91, 48.6, 10),
('PIPE-HP-2400', '布パイプ 2400mm',   'Horizontal Pipe 2400mm', 'horizontal', 'single_pipe', 'φ48.6×2400mm', '本', 2400, 6.55, 48.6, 11),
('PIPE-HP-3000', '布パイプ 3000mm',   'Horizontal Pipe 3000mm', 'horizontal', 'single_pipe', 'φ48.6×3000mm', '本', 3000, 8.19, 48.6, 12),
('PIPE-HP-4000', '布パイプ 4000mm',   'Horizontal Pipe 4000mm', 'horizontal', 'single_pipe', 'φ48.6×4000mm', '本', 4000, 10.92, 48.6, 13),
('PIPE-BR-5000', '筋交いパイプ 5000mm', 'Brace Pipe 5000mm', 'brace',      'single_pipe', 'φ48.6×5000mm', '本', 5000, 13.65, 48.6, 20),
('PIPE-CL-RIGHT', '直交クランプ',     'Right-angle Clamp',   'clamp',       'single_pipe', 'φ48.6',        '個', NULL, 0.75, 48.6, 30),
('PIPE-CL-SWIVEL', '自在クランプ',    'Swivel Clamp',        'clamp',       'single_pipe', 'φ48.6',        '個', NULL, 0.68, 48.6, 31),
('PIPE-PL-240x4000', '足場板 240×4000mm', 'Plank 240×4000mm', 'plank',     'single_pipe', '240×4000mm',   '枚', 4000, NULL, NULL, 35),
('PIPE-LADDER-2000', '昇降用はしご 2000mm', 'Ladder 2000mm',  'stairway',   'single_pipe', '2000mm',       '本', 2000, NULL, NULL, 40)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 5. Seed: Next-Gen Scaffold Materials (次世代足場)
-- ============================================================

-- 5a. System Posts (支柱)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, sort_order) VALUES
('NEXTGEN-POST-600',  '支柱 600mm',  'System Post 600mm',  'post', 'next_gen', '600mm',  '本', 600,  3.2, 1),
('NEXTGEN-POST-900',  '支柱 900mm',  'System Post 900mm',  'post', 'next_gen', '900mm',  '本', 900,  4.5, 2),
('NEXTGEN-POST-1200', '支柱 1200mm', 'System Post 1200mm', 'post', 'next_gen', '1200mm', '本', 1200, 5.8, 3),
('NEXTGEN-POST-1500', '支柱 1500mm', 'System Post 1500mm', 'post', 'next_gen', '1500mm', '本', 1500, 7.1, 4),
('NEXTGEN-POST-1800', '支柱 1800mm', 'System Post 1800mm', 'post', 'next_gen', '1800mm', '本', 1800, 8.4, 5)
ON CONFLICT (code) DO NOTHING;

-- 5b. Horizontal Beams (横架材)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('NEXTGEN-HB-610',  '横架材 610mm',  'Horizontal Beam 610mm',  'horizontal', 'next_gen', '610mm',  '本', 610,  10),
('NEXTGEN-HB-914',  '横架材 914mm',  'Horizontal Beam 914mm',  'horizontal', 'next_gen', '914mm',  '本', 914,  11),
('NEXTGEN-HB-1219', '横架材 1219mm', 'Horizontal Beam 1219mm', 'horizontal', 'next_gen', '1219mm', '本', 1219, 12),
('NEXTGEN-HB-1524', '横架材 1524mm', 'Horizontal Beam 1524mm', 'horizontal', 'next_gen', '1524mm', '本', 1524, 13),
('NEXTGEN-HB-1829', '横架材 1829mm', 'Horizontal Beam 1829mm', 'horizontal', 'next_gen', '1829mm', '本', 1829, 14)
ON CONFLICT (code) DO NOTHING;

-- 5c. Iq Handrails (Iq手すり)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, bundle_quantity, rental_price_monthly, sort_order) VALUES
('NEXTGEN-HR-1829', 'Iq手すり 1829mm', 'Iq Handrail 1829mm', 'handrail', 'next_gen', '1829mm', '本', 1829, 4.4, 50, 210000, 20),
('NEXTGEN-HR-1524', 'Iq手すり 1524mm', 'Iq Handrail 1524mm', 'handrail', 'next_gen', '1524mm', '本', 1524, 3.7, 50, 185000, 21),
('NEXTGEN-HR-1219', 'Iq手すり 1219mm', 'Iq Handrail 1219mm', 'handrail', 'next_gen', '1219mm', '本', 1219, 3.0, 50, 175000, 22),
('NEXTGEN-HR-1107', 'Iq手すり 1107mm', 'Iq Handrail 1107mm', 'handrail', 'next_gen', '1107mm', '本', 1107, 2.8, 50, 175000, 23),
('NEXTGEN-HR-914',  'Iq手すり 914mm',  'Iq Handrail 914mm',  'handrail', 'next_gen', '914mm',  '本', 914,  2.3, 50, 160000, 24),
('NEXTGEN-HR-722',  'Iq手すり 722mm',  'Iq Handrail 722mm',  'handrail', 'next_gen', '722mm',  '本', 722,  2.0, 50, 160000, 25),
('NEXTGEN-HR-610',  'Iq手すり 610mm',  'Iq Handrail 610mm',  'handrail', 'next_gen', '610mm',  '本', 610,  1.6, 50, 140000, 26),
('NEXTGEN-HR-360',  'Iq手すり 360mm',  'Iq Handrail 360mm',  'handrail', 'next_gen', '360mm',  '本', 360,  1.0, 30, 135000, 27),
('NEXTGEN-HR-305',  'Iq手すり 305mm',  'Iq Handrail 305mm',  'handrail', 'next_gen', '305mm',  '本', 305,  0.9, 20, 130000, 28),
('NEXTGEN-HR-250',  'Iq手すり 250mm',  'Iq Handrail 250mm',  'handrail', 'next_gen', '250mm',  '本', 250,  0.8, 30, 125000, 29)
ON CONFLICT (code) DO NOTHING;

-- 5d. JFX Combined Handrail+Brace (先行手摺付きブレース)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, weight_kg, pipe_diameter_mm, is_combined, sort_order) VALUES
('NEXTGEN-JFX-183N', '先行手摺付きブレース JFX-183N', 'Leading Handrail+Brace JFX-183N', 'handrail_brace', 'next_gen', '1829mm', '本', 1829, 6.8, 27.2, true, 30),
('NEXTGEN-JFX-153N', '先行手摺付きブレース JFX-153N', 'Leading Handrail+Brace JFX-153N', 'handrail_brace', 'next_gen', '1524mm', '本', 1524, 5.9, 27.2, true, 31),
('NEXTGEN-JFX-123N', '先行手摺付きブレース JFX-123N', 'Leading Handrail+Brace JFX-123N', 'handrail_brace', 'next_gen', '1219mm', '本', 1219, 5.1, 27.2, true, 32),
('NEXTGEN-JFX-093N', '先行手摺付きブレース JFX-093N', 'Leading Handrail+Brace JFX-093N', 'handrail_brace', 'next_gen', '914mm',  '本', 914,  4.3, 27.2, true, 33),
('NEXTGEN-JFX-063N', '先行手摺付きブレース JFX-063N', 'Leading Handrail+Brace JFX-063N', 'handrail_brace', 'next_gen', '610mm',  '本', 610,  3.6, 27.2, true, 34)
ON CONFLICT (code) DO NOTHING;

-- 5e. Decks (デッキ・床付き布枠)
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, standard_width_mm, sort_order) VALUES
('NEXTGEN-DECK-400x610',  'デッキ 400×610mm',  'Deck 400×610mm',  'plank', 'next_gen', '400×610mm',  '枚', 610,  400, 40),
('NEXTGEN-DECK-400x914',  'デッキ 400×914mm',  'Deck 400×914mm',  'plank', 'next_gen', '400×914mm',  '枚', 914,  400, 41),
('NEXTGEN-DECK-400x1219', 'デッキ 400×1219mm', 'Deck 400×1219mm', 'plank', 'next_gen', '400×1219mm', '枚', 1219, 400, 42),
('NEXTGEN-DECK-400x1524', 'デッキ 400×1524mm', 'Deck 400×1524mm', 'plank', 'next_gen', '400×1524mm', '枚', 1524, 400, 43),
('NEXTGEN-DECK-400x1829', 'デッキ 400×1829mm', 'Deck 400×1829mm', 'plank', 'next_gen', '400×1829mm', '枚', 1829, 400, 44),
('NEXTGEN-DECK-500x1829', 'デッキ 500×1829mm', 'Deck 500×1829mm', 'plank', 'next_gen', '500×1829mm', '枚', 1829, 500, 45),
('NEXTGEN-DECK-600x1829', 'デッキ 600×1829mm', 'Deck 600×1829mm', 'plank', 'next_gen', '600×1829mm', '枚', 1829, 600, 46)
ON CONFLICT (code) DO NOTHING;

-- 5f. Next-Gen Stairway Unit
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('NEXTGEN-STAIR-1800', '階段ユニット 1800mm', 'Stairway Unit 1800mm', 'stairway', 'next_gen', '1800mm', 'セット', 1800, 50)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 6. Additional Horizontal Bars (shorter sizes for all types)
-- ============================================================
INSERT INTO scaffold_materials (code, name_jp, name_en, category, scaffold_type, size_spec, unit, standard_length_mm, sort_order) VALUES
('FRAME-HB-200', '横材 200mm', 'Horizontal Bar 200mm', 'horizontal', 'frame', '200mm', '本', 200, 15),
('FRAME-HB-300', '横材 300mm', 'Horizontal Bar 300mm', 'horizontal', 'frame', '300mm', '本', 300, 16),
('FRAME-HB-400', '横材 400mm', 'Horizontal Bar 400mm', 'horizontal', 'frame', '400mm', '本', 400, 17),
('FRAME-HB-600', '横材 600mm', 'Horizontal Bar 600mm', 'horizontal', 'frame', '600mm', '本', 600, 18),
('FRAME-HB-900', '横材 900mm', 'Horizontal Bar 900mm', 'horizontal', 'frame', '900mm', '本', 900, 19)
ON CONFLICT (code) DO NOTHING;
