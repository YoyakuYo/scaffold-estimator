-- Optional per-piece length (mm) for steel takeoff rows. When NULL, the
-- erection sequencer and steel summary use the default length per element type.

ALTER TABLE public.extracted_elements
  ADD COLUMN IF NOT EXISTS piece_length_mm integer NULL;

COMMENT ON COLUMN public.extracted_elements.piece_length_mm IS
  'Single-member length in mm for weight/length rollups; null = type default.';
