-- Password reset tokens (hashed). Backend uses service_role only.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON public.password_reset_tokens (expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.password_reset_tokens IS 'One-time hashed tokens for self-service password reset emails.';

-- Case-insensitive email lookup (avoids ILIKE wildcards in email addresses).
CREATE OR REPLACE FUNCTION public.get_user_id_by_email_ci(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id
  FROM public.users
  WHERE lower(trim(email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email_ci(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email_ci(text) TO service_role;
