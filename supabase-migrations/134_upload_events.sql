-- Unified upload activity feed for the superadmin ops cockpit.
-- Insert-only (audit-trail style): backend writes one row per upload, regardless of product.
-- Surfaces drawings, scaffold configurations, AI-extract uploads, and (later) BIM / Construction Plan uploads.

CREATE TABLE IF NOT EXISTS public.upload_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  product_code text NOT NULL DEFAULT 'scaffold',
  kind text NOT NULL,
  filename text,
  mime_type text,
  size_bytes bigint,
  ref_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_events_created_at_idx
  ON public.upload_events (created_at DESC);
CREATE INDEX IF NOT EXISTS upload_events_user_id_idx
  ON public.upload_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_events_company_id_idx
  ON public.upload_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_events_product_code_idx
  ON public.upload_events (product_code, created_at DESC);

-- Service role only.
ALTER TABLE public.upload_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upload_events_service_role_all ON public.upload_events;
CREATE POLICY upload_events_service_role_all
  ON public.upload_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
