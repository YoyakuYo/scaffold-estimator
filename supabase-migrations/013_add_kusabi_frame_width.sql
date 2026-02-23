-- Migration: Add frame_width_mm column for Kusabi scaffolding
-- This column is specific to Kusabi (くさび式足場) and defines the frame width (450, 600, 900, 1200mm)

-- Add frame_width_mm column to scaffold_configurations
ALTER TABLE scaffold_configurations
ADD COLUMN IF NOT EXISTS frame_width_mm INT;

-- Add comment
COMMENT ON COLUMN scaffold_configurations.frame_width_mm IS 'Frame width in mm for Kusabi scaffolding (450, 600, 900, 1200). Defines distance between front and back Tateji rows.';
