-- BIM Viewer: persisted models in Supabase Storage + metadata for reopen,
-- audit, and DWG intake (conversion_status reserved for a future worker).

BEGIN;
SELECT set_config('storage.allow_delete_query', 'true', true);
SELECT set_config('storage.can_delete', 'true', true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('bim-viewer-files', 'bim-viewer-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS bim_viewer_files_service_role_all ON storage.objects;
CREATE POLICY bim_viewer_files_service_role_all
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'bim-viewer-files' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'bim-viewer-files' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS bim_viewer_files_authenticated_read ON storage.objects;
CREATE POLICY bim_viewer_files_authenticated_read
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'bim-viewer-files' AND auth.role() = 'authenticated');

COMMIT;

-- Table DDL outside the storage GUC transaction.
CREATE TABLE IF NOT EXISTS public.bim_viewer_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  filename text NOT NULL,
  display_name text,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  -- file_kind: ifc | dxf | pdf | dwg
  file_kind text NOT NULL,
  -- conversion_status: na | pending | ready (pending for DWG until converter exists)
  conversion_status text NOT NULL DEFAULT 'na',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bim_viewer_models_company_idx
  ON public.bim_viewer_models (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bim_viewer_models_created_by_idx
  ON public.bim_viewer_models (created_by, created_at DESC);

COMMENT ON TABLE public.bim_viewer_models IS 'Saved BIM viewer uploads (IFC/DXF/PDF/DWG bytes in bim-viewer-files bucket).';
