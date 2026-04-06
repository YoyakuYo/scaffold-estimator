-- Supabase linter: RLS on public tables exposed to PostgREST.
-- Backend uses service_role and bypasses RLS; no policies = anon/authenticated cannot read/write via API.

ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_dm_messages ENABLE ROW LEVEL SECURITY;
