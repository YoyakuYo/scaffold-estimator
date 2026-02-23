-- ============================================================
-- Migration 006: Row Level Security (RLS) Policies
-- Run this SIXTH in Supabase SQL Editor
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

-- Enable RLS on all tables
ALTER TABLE companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE geometry_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_master_data  ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_exports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed: service_role and postgres roles bypass RLS automatically
