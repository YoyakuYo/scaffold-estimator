-- Distance from building wall to nearest posts (tateji) in mm: 250–500. Lets scaffold "breathe".
ALTER TABLE scaffold_configurations ADD COLUMN IF NOT EXISTS wall_standoff_mm INT NOT NULL DEFAULT 350;
-- Optional: constrain to 250–500 in app; DB allows default for existing rows
COMMENT ON COLUMN scaffold_configurations.wall_standoff_mm IS 'Distance from building wall to nearest posts (mm). 250–500 so scaffold can breathe.';
