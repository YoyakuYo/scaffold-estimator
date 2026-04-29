-- Structural BIM generator: editable grid/storey/member model + optional
-- link to a generated bim_viewer_models IFC row.

CREATE TABLE IF NOT EXISTS public.structural_bim_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Structural model',
  -- Phase 1 canonical JSON: gridX, gridY, storeys, members (see backend types)
  model_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  job_status text NOT NULL DEFAULT 'idle',
  job_error text,
  output_model_id uuid REFERENCES public.bim_viewer_models(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS structural_bim_projects_company_idx
  ON public.structural_bim_projects (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS structural_bim_projects_created_by_idx
  ON public.structural_bim_projects (created_by, created_at DESC);

COMMENT ON TABLE public.structural_bim_projects IS '2D grid + members → generated IFC (structural-bim API).';
