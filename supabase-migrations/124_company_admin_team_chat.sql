-- Company admin: exactly one per company (invites, billing UI, user management for org).
-- Team chat: internal messages scoped by company_id.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_company_admin BOOLEAN NOT NULL DEFAULT false;

-- At most one company admin per company (PostgreSQL partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_company_admin
  ON public.users (company_id)
  WHERE is_company_admin = true;

CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_chat_messages_company_created
  ON public.team_chat_messages (company_id, created_at DESC);

-- Backfill: one admin per company (earliest approved non-superadmin by created_at).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id
      ORDER BY created_at ASC
    ) AS rn
  FROM public.users
  WHERE role <> 'superadmin'
    AND approval_status = 'approved'
    AND is_active = true
)
UPDATE public.users u
SET is_company_admin = true
FROM ranked r
WHERE u.id = r.id
  AND r.rn = 1
  AND u.is_company_admin IS NOT TRUE;
