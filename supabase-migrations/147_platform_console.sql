-- ============================================================
-- Migration 147: Platform console — settings, audit, analytics, TOTP
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  feature_disable_signup boolean NOT NULL DEFAULT false,
  feature_disable_ai_extraction boolean NOT NULL DEFAULT false,
  feature_disable_file_uploads boolean NOT NULL DEFAULT false,
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users (id)
);

INSERT INTO public.platform_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.users (id),
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.platform_audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS public.site_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  path text,
  referrer text,
  user_agent text,
  anon_key text,
  user_id uuid REFERENCES public.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_analytics_created ON public.site_analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_analytics_type_created ON public.site_analytics_events (event_type, created_at DESC);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON TABLE public.platform_settings IS 'Singleton row (id=1): feature flags and maintenance for platform operators.';
COMMENT ON TABLE public.platform_audit_log IS 'Append-only audit trail for superadmin actions (flags, impersonation, broadcasts).';
COMMENT ON TABLE public.site_analytics_events IS 'Anonymous or authenticated page-view / visit events for operator analytics.';
