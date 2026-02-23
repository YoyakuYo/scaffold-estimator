-- ============================================================
-- SUPER ADMIN — SELF-CONTAINED SETUP
-- Run this in Supabase SQL Editor (creates tables if needed)
-- ============================================================
-- INSTRUCTIONS:
--   1. Replace YOUR_EMAIL with your real email
--   2. Replace YOUR_BCRYPT_HASH with a bcrypt hash of your password
--      Generate one at: https://bcrypt-generator.com/ (use 10 rounds)
--   3. Replace YOUR_FIRST_NAME with your name
--   4. Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Create companies table if it doesn't exist ───────────
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

-- ── 2. Create users table if it doesn't exist ───────────────
CREATE TABLE IF NOT EXISTS users (
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
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Create company_branches table if it doesn't exist ────
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

-- ── 4. Insert platform owner company ────────────────────────
INSERT INTO companies (id, name, email)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Platform Admin',
  'admin@platform.local'
)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Insert super admin user ──────────────────────────────
-- ⚠️  REPLACE the placeholders below before running!
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active, approval_status)
VALUES (
  'b0000000-0000-0000-0000-000000000099',
  'a0000000-0000-0000-0000-000000000001',
  'YOUR_EMAIL',           -- ← replace with your email
  'YOUR_BCRYPT_HASH',     -- ← replace with bcrypt hash of your password
  'admin',
  'YOUR_FIRST_NAME',      -- ← replace with your name
  'Admin',
  TRUE,
  'approved'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'admin',
  is_active = TRUE,
  approval_status = 'approved';

-- ── 6. Verify ───────────────────────────────────────────────
SELECT id, email, role, is_active, approval_status FROM users WHERE role = 'admin';
