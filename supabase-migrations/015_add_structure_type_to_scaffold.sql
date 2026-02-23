-- ============================================================
-- Migration 015: Add structure_type column to scaffold_configurations
-- ============================================================

-- Add structure_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'structure_type'
  ) THEN
    ALTER TABLE scaffold_configurations 
    ADD COLUMN structure_type VARCHAR(20) NOT NULL DEFAULT '改修工事';
    
    COMMENT ON COLUMN scaffold_configurations.structure_type IS 
      'Construction pattern: 改修工事 (most complex, 1.25x), S造 (medium, 1.0x), RC造 (simplest, 0.9x)';
  END IF;
END $$;
