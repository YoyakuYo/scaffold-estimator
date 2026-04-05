-- Migrate legacy nominal scaffold widths (600/900/1200) to catalog mm (610/914/1219).
-- Per-wall JSON is normalized at read time in the API until the next save/recalculate.

UPDATE scaffold_configurations
SET scaffold_width_mm = CASE scaffold_width_mm
  WHEN 600 THEN 610
  WHEN 900 THEN 914
  WHEN 1200 THEN 1219
  ELSE scaffold_width_mm
END
WHERE scaffold_width_mm IN (600, 900, 1200);
