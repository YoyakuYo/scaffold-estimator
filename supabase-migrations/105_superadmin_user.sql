-- ============================================================
-- SUPER ADMIN — SELF-CONTAINED SETUP
-- Run this in Supabase SQL Editor
-- ============================================================
-- INSTRUCTIONS:
--   1. Run in Supabase SQL Editor
--   2. Super admin: omarsowbarca45@gmail.com
-- ============================================================
--
-- The backend uses its own auth (bcrypt + JWT), NOT Supabase Auth.
-- It expects: companies, users (with company_id, password_hash),
-- and company_branches tables.
--
-- If migration 100 (organizations/branches) was already run,
-- those tables are separate and won't conflict.
-- ============================================================

-- ── 1. Create companies table (backend auth schema) ─────────
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  tax_id      TEXT,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  postal_code TEXT,
  prefecture  TEXT,
  city        TEXT,
  town        TEXT,
  address_line TEXT,
  building    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Recreate users table for backend auth schema ─────────
-- Migration 100 may have created a users table with organization_id
-- and RLS policies. We need to drop everything and recreate with
-- company_id + password_hash that the backend expects.

-- Drop RLS policies that reference users table
DO $$ DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Drop all tables from migration 100 that conflict
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS login_history CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- Drop helper functions from migration 100
DROP FUNCTION IF EXISTS public.get_my_organization_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_branch_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;

CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'viewer',
  first_name       TEXT,
  last_name        TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  approval_status  TEXT NOT NULL DEFAULT 'pending',
  last_active_at   TIMESTAMPTZ,
  branch_id        UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id);

-- ── 3. Create company_branches table ────────────────────────
CREATE TABLE IF NOT EXISTS company_branches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  is_headquarters  BOOLEAN NOT NULL DEFAULT false,
  postal_code      TEXT,
  prefecture       TEXT,
  city             TEXT,
  town             TEXT,
  address_line     TEXT,
  building         TEXT,
  phone            TEXT,
  fax              TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Create other tables the backend expects ──────────────
CREATE TABLE IF NOT EXISTS scaffold_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  created_by       UUID,
  scaffold_type    TEXT NOT NULL DEFAULT 'kusabi',
  building_height  NUMERIC,
  scaffold_width   NUMERIC,
  post_size        NUMERIC,
  top_guard        NUMERIC,
  structure_type   TEXT DEFAULT 'steel',
  walls            JSONB DEFAULT '[]',
  quantities       JSONB DEFAULT '[]',
  span_config      JSONB DEFAULT '[]',
  status           TEXT DEFAULT 'calculated',
  frame_size       NUMERIC,
  habaki_count     INTEGER DEFAULT 2,
  end_stopper_type TEXT DEFAULT 'nuno',
  rental_period    JSONB,
  branch_id        UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Insert platform owner company ────────────────────────
INSERT INTO companies (id, name, email)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Platform Admin',
  'admin@platform.local'
)
ON CONFLICT (id) DO NOTHING;

-- ── 6. Insert super admin user ──────────────────────────────
-- ⚠️  REPLACE the 3 placeholders below before running!
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active, approval_status)
VALUES (
  'b0000000-0000-0000-0000-000000000099',
  'a0000000-0000-0000-0000-000000000001',
  'omarsowbarca45@gmail.com',
  '$2b$10$mJokbgKSccKxTic5KJgPTu2yDRg04xNqJqcafYLh0wSNfK5/ROn3u',
  'superadmin',
  'Omar'
  'Admin',
  TRUE,
  'approved'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'superadmin',
  is_active = TRUE,
  approval_status = 'approved';

-- ── 7. Verify ───────────────────────────────────────────────
SELECT '✅ Setup complete!' AS status;
SELECT id, email, role, is_active, approval_status FROM users WHERE email = 'omarsowbarca45@gmail.com';
