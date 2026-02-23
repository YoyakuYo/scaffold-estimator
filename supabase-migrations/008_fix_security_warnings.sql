-- ============================================================
-- Migration 008: Fix Security Warnings
-- Run this to fix Supabase linter warnings
-- ============================================================

-- ── Fix 1: Set search_path on function (prevents search path injection) ──
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── Fix 2: Remove permissive RLS policies ───────────────────────────────
-- Since the NestJS backend uses service_role key which bypasses RLS,
-- these permissive policies are unnecessary and trigger security warnings.
-- RLS is still enabled on tables, but service_role will bypass it anyway.

DROP POLICY IF EXISTS "service_all_companies" ON companies;
DROP POLICY IF EXISTS "service_all_users" ON users;
DROP POLICY IF EXISTS "service_all_drawings" ON drawings;
DROP POLICY IF EXISTS "service_all_geometry_elements" ON geometry_elements;
DROP POLICY IF EXISTS "service_all_estimates" ON estimates;
DROP POLICY IF EXISTS "service_all_cost_line_items" ON cost_line_items;
DROP POLICY IF EXISTS "service_all_cost_master_data" ON cost_master_data;
DROP POLICY IF EXISTS "service_all_estimate_exports" ON estimate_exports;
DROP POLICY IF EXISTS "service_all_audit_log" ON audit_log;

-- Note: RLS remains enabled on all tables. The NestJS backend uses
-- the service_role key which automatically bypasses RLS, so no policies
-- are needed. If you later add Supabase Auth or direct client access,
-- you can add proper RLS policies at that time.
