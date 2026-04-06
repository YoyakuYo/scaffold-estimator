-- Direct (1:1) messages between users in the same company.

CREATE TABLE IF NOT EXISTS public.team_dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_dm_no_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_team_dm_company_created
  ON public.team_dm_messages (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_dm_pair
  ON public.team_dm_messages (company_id, sender_id, recipient_id);
