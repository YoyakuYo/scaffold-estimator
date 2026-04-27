-- Unified upload activity feed for the superadmin ops cockpit.
-- Insert-only (audit-trail style): backend writes one row per upload, regardless of product.
-- Surfaces drawings, scaffold configurations, AI-extract uploads, and (later) BIM / Construction Plan uploads.

CREATE TABLE IF NOT EXISTS public.upload_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Tenant scope UUID: legacy DBs use companies(id); post–100 SaaS uses organizations(id).
  -- FK is added below against whichever parent table exists.
  company_id uuid,
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upload_events_company_id_fkey'
  ) THEN
    RETURN;
  END IF;
  IF to_regclass('public.companies') IS NOT NULL THEN
    ALTER TABLE public.upload_events
      ADD CONSTRAINT upload_events_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE SET NULL;
  ELSIF to_regclass('public.organizations') IS NOT NULL THEN
    ALTER TABLE public.upload_events
      ADD CONSTRAINT upload_events_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.organizations (id) ON DELETE SET NULL;
  END IF;
END $$;

-- Service role only.
ALTER TABLE public.upload_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upload_events_service_role_all ON public.upload_events;
CREATE POLICY upload_events_service_role_all
  ON public.upload_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
