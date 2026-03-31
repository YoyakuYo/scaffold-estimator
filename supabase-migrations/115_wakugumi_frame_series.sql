-- Wakugumi walk-through frame product line (FT-617 / FT-917 / FT-1217)
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS wakugumi_frame_series VARCHAR(10) DEFAULT 'FT917';

UPDATE scaffold_configurations
SET wakugumi_frame_series = CASE
  WHEN scaffold_width_mm <= 600 THEN 'FT617'
  WHEN scaffold_width_mm <= 900 THEN 'FT917'
  ELSE 'FT1217'
END
WHERE scaffold_type = 'wakugumi'
  AND (wakugumi_frame_series IS NULL OR wakugumi_frame_series = 'FT917');

COMMENT ON COLUMN scaffold_configurations.wakugumi_frame_series IS 'Wakugumi frame line: FT617, FT917, FT1217';
