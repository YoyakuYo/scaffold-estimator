-- Repair: structural takeoff `extracted_elements` columns expected by the backend
-- (AI extraction, IFC, review flags) plus PostgREST schema reload.
--
-- Symptom (Supabase JS / PostgREST): "Could not find the 'extraction_confidence'
-- column of 'extracted_elements' in the schema cache" on extract-elements-ai.
-- Causes:
--   1) Migrations 142/143 were not applied on this database, or
--   2) Columns exist but PostgREST did not reload (run NOTIFY below).
--
-- Safe to re-run: all column adds use IF NOT EXISTS.

ALTER TABLE public.extracted_elements
  ADD COLUMN IF NOT EXISTS piece_length_mm integer NULL;

ALTER TABLE public.extracted_elements
  ADD COLUMN IF NOT EXISTS phase text NULL,
  ADD COLUMN IF NOT EXISTS shop text NULL,
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS extraction_confidence real NULL,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.extracted_elements.piece_length_mm IS
  'Single-member length in mm for weight/length rollups; null = type default.';
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

NOTIFY pgrst, 'reload schema';
