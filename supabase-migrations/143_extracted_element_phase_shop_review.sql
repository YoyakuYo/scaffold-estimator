-- Extended takeoff fields for steel/structure workflows: phase, shop, line kind,
-- AI confidence, and human-in-the-loop review flag.

ALTER TABLE public.extracted_elements
  ADD COLUMN IF NOT EXISTS phase text NULL,
  ADD COLUMN IF NOT EXISTS shop text NULL,
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS extraction_confidence real NULL,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.extracted_elements.phase IS 'Erection / work phase label (optional).';
COMMENT ON COLUMN public.extracted_elements.shop IS 'Fabrication shop / lot tag (optional).';
COMMENT ON COLUMN public.extracted_elements.line_kind IS 'member | bolt | connection | misc';
COMMENT ON COLUMN public.extracted_elements.extraction_confidence IS '0–1 when produced by AI; null for manual/import.';
COMMENT ON COLUMN public.extracted_elements.needs_review IS 'True until estimator confirms AI/IFC row.';

ALTER TABLE public.extracted_elements
  DROP CONSTRAINT IF EXISTS extracted_elements_line_kind_check;

ALTER TABLE public.extracted_elements
  ADD CONSTRAINT extracted_elements_line_kind_check
  CHECK (line_kind IN ('member', 'bolt', 'connection', 'misc'));
