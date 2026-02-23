-- ═══════════════════════════════════════════════════════════════
-- Migration 014: Kusabi-Only Rewrite
-- ═══════════════════════════════════════════════════════════════
-- Drops old scaffold_type-dependent columns, adds new kusabi-only
-- structure with per-wall calculation support.

-- Step 1: Drop old columns that are no longer needed
ALTER TABLE scaffold_configurations
  DROP COLUMN IF EXISTS structure_type,
  DROP COLUMN IF EXISTS scaffold_type,
  DROP COLUMN IF EXISTS total_facade_length,
  DROP COLUMN IF EXISTS span_spacing_mm,
  DROP COLUMN IF EXISTS level_height_mm,
  DROP COLUMN IF EXISTS wall_distance_mm,
  DROP COLUMN IF EXISTS plank_width_mm,
  DROP COLUMN IF EXISTS post_type,
  DROP COLUMN IF EXISTS span_spacing,
  DROP COLUMN IF EXISTS level_height,
  DROP COLUMN IF EXISTS rental_type,
  DROP COLUMN IF EXISTS rental_start_date,
  DROP COLUMN IF EXISTS rental_end_date;

-- Step 2: Add new columns
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS building_height_mm INT,
  ADD COLUMN IF NOT EXISTS walls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scaffold_width_mm INT DEFAULT 600,
  ADD COLUMN IF NOT EXISTS preferred_main_tateji_mm INT DEFAULT 1800,
  ADD COLUMN IF NOT EXISTS top_guard_height_mm INT DEFAULT 900,
  ADD COLUMN IF NOT EXISTS calculation_result JSONB;

-- Step 3: Make drawing_id nullable (manual mode doesn't need a drawing)
ALTER TABLE scaffold_configurations
  ALTER COLUMN drawing_id DROP NOT NULL;

-- Step 4: Rename building_height to building_height_mm if old column exists
-- (handle gracefully if building_height was decimal)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'building_height'
    AND data_type IN ('numeric', 'decimal')
  ) THEN
    -- Old column was in meters, we need mm
    UPDATE scaffold_configurations 
    SET building_height_mm = COALESCE(building_height::INT * 1000, 0)
    WHERE building_height_mm IS NULL;
    
    ALTER TABLE scaffold_configurations DROP COLUMN IF EXISTS building_height;
  END IF;
END $$;

-- Step 5: Clean up old frame_width_mm → rename to scaffold_width_mm if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'frame_width_mm'
  ) THEN
    UPDATE scaffold_configurations 
    SET scaffold_width_mm = COALESCE(frame_width_mm, 600)
    WHERE scaffold_width_mm IS NULL OR scaffold_width_mm = 0;
    
    ALTER TABLE scaffold_configurations DROP COLUMN frame_width_mm;
  END IF;
END $$;

-- Step 6: Ensure calculated_quantities table is clean
-- No structural changes needed — it already supports component_type, component_name, size_spec

-- Step 7: Drop scaffold_materials table if it had old scaffold_type-specific data
-- We'll keep the table structure but clear old data
DELETE FROM scaffold_materials WHERE scaffold_type IN ('frame', 'next_gen');

-- Update remaining materials to kusabi type
UPDATE scaffold_materials SET scaffold_type = 'kusabi' WHERE scaffold_type IS NULL OR scaffold_type = '';
