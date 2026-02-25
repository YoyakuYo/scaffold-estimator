-- ============================================================
-- Migration 110: Enable RLS on all public tables (Supabase linter)
-- ============================================================
-- Fixes "RLS Disabled in Public" and "Sensitive Columns Exposed"
-- for tables exposed to PostgREST. Backend uses service_role and
-- bypasses RLS; enabling RLS with no policies = only service_role
-- can access (secure by default).
-- ============================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'migrations',
    'conversations',
    'messages',
    'companies',
    'users',
    'company_branches',
    'scaffold_configs',
    'login_history',
    'notifications',
    'subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      RAISE NOTICE 'RLS enabled on public.%', t;
    END IF;
  END LOOP;
END $$;
