-- ============================================================
-- COMPANY BRANCHES & JAPANESE ADDRESS FIELDS
-- Adds structured address fields to companies table
-- and creates company_branches for multi-branch support
-- ============================================================

-- ── 1. Add structured address columns to companies ──────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS postal_code  TEXT,        -- 郵便番号 e.g. "100-0001"
  ADD COLUMN IF NOT EXISTS prefecture   TEXT,        -- 都道府県 e.g. "東京都"
  ADD COLUMN IF NOT EXISTS city         TEXT,        -- 市区町村 e.g. "千代田区"
  ADD COLUMN IF NOT EXISTS town         TEXT,        -- 町域     e.g. "千代田"
  ADD COLUMN IF NOT EXISTS address_line TEXT,        -- 番地     e.g. "1-1-1"
  ADD COLUMN IF NOT EXISTS building     TEXT;        -- 建物名   e.g. "○○ビル 3F"


-- ── 2. Create company_branches table ────────────────────────
CREATE TABLE IF NOT EXISTS company_branches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                   -- 支店名 e.g. "本社", "大阪支店"
  is_headquarters  BOOLEAN NOT NULL DEFAULT false,  -- 本社フラグ
  postal_code      TEXT,                            -- 郵便番号
  prefecture       TEXT,                            -- 都道府県
  city             TEXT,                            -- 市区町村
  town             TEXT,                            -- 町域
  address_line     TEXT,                            -- 番地
  building         TEXT,                            -- 建物名
  phone            TEXT,
  fax              TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_branches_company_id
  ON company_branches (company_id);


-- ── 3. Add branch_id to users (optional assignment) ─────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES company_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users (branch_id);


-- ── 4. Verification ─────────────────────────────────────────
SELECT '✅ Company branches & address fields migration complete!' AS status;
