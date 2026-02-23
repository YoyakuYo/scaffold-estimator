-- ============================================================
-- Migration 013: Enable RLS on scaffold-related tables
-- Fixes security linter errors for missing RLS on public tables
-- ============================================================
-- NOTE: Since this app uses a NestJS backend with JWT auth
-- (not Supabase Auth directly), the backend connects via the
-- service_role key which BYPASSES RLS entirely.
--
-- RLS is enabled on all tables for security best practices.
-- No policies are needed because:
-- 1. The NestJS backend uses service_role key (bypasses RLS)
-- 2. Migrations/seeds run as postgres role (bypasses RLS)
--
-- If you later add Supabase Auth or direct client access,
-- you can add proper RLS policies at that time.
-- ============================================================

-- Enable RLS on scaffold-related tables
ALTER TABLE scaffold_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculated_quantities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scaffold_materials     ENABLE ROW LEVEL SECURITY;