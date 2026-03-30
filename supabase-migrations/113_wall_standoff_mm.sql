-- Distance from building wall to nearest posts (tateji) in mm: 250–500. Lets scaffold "breathe".
-- Run this migration on your Supabase (or Postgres) so the column exists. Until then, the app
-- does not write this column (standoff is stored in calculation_result JSON only).
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS wall_standoff_mm INT NOT NULL DEFAULT 300;
COMMENT ON COLUMN scaffold_configurations.wall_standoff_mm IS 'Distance from building wall to nearest posts (mm). 250–500 so scaffold can breathe.';
