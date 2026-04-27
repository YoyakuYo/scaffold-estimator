-- Live presence: which page each logged-in user is currently looking at, plus their last action.
-- One row per user; backend upserts on heartbeat (every ~30s) and on action.
-- "Online" = updated_at within the last 3 minutes (matches existing heartbeat policy).

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  page_key text,
  label text,
  last_action text,
  last_action_at timestamptz,
  ip_address inet,
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_presence_updated_at_idx
  ON public.user_presence (updated_at DESC);

-- Service role only (regular users never read this directly; backend exposes admin endpoints).
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_presence_service_role_all ON public.user_presence;
CREATE POLICY user_presence_service_role_all
  ON public.user_presence
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
