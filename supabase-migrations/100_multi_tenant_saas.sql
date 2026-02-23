-- ============================================================
-- MULTI-TENANT SAAS ARCHITECTURE — CLEAN REPLACEMENT
-- Organization + Branch Isolation with Row Level Security
-- ============================================================
-- This REPLACES the entire old schema. Run in Supabase SQL Editor.
-- Old tables (companies, users, drawings, etc.) must be dropped
-- first or this must run on a fresh Supabase project.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- STEP 0: DROP OLD SCHEMA
-- ════════════════════════════════════════════════════════════
-- Drop everything from the old schema in dependency order.
-- CASCADE ensures dependent objects (policies, triggers,
-- indexes, foreign keys) are removed automatically.
-- Safe to run even if tables don't exist.
-- ════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS estimate_exports  CASCADE;
DROP TABLE IF EXISTS cost_line_items   CASCADE;
DROP TABLE IF EXISTS cost_master_data  CASCADE;
DROP TABLE IF EXISTS estimates         CASCADE;
DROP TABLE IF EXISTS geometry_elements CASCADE;
DROP TABLE IF EXISTS drawings          CASCADE;
DROP TABLE IF EXISTS scaffold_configs  CASCADE;
DROP TABLE IF EXISTS quotation_cost_items CASCADE;
DROP TABLE IF EXISTS audit_log         CASCADE;
DROP TABLE IF EXISTS users             CASCADE;
DROP TABLE IF EXISTS companies         CASCADE;
DROP TABLE IF EXISTS projects          CASCADE;
DROP TABLE IF EXISTS organizations     CASCADE;
DROP TABLE IF EXISTS branches          CASCADE;

-- Drop old enum types
DROP TYPE IF EXISTS user_role            CASCADE;
DROP TYPE IF EXISTS drawing_file_format  CASCADE;
DROP TYPE IF EXISTS drawing_upload_status CASCADE;
DROP TYPE IF EXISTS structure_type       CASCADE;
DROP TYPE IF EXISTS rental_period_type   CASCADE;
DROP TYPE IF EXISTS estimate_status      CASCADE;
DROP TYPE IF EXISTS cost_category        CASCADE;
DROP TYPE IF EXISTS geometry_element_type CASCADE;
DROP TYPE IF EXISTS export_format        CASCADE;

-- Drop old trigger function
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Drop helper functions if they exist from a previous run
DROP FUNCTION IF EXISTS public.get_my_organization_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_branch_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;


-- ════════════════════════════════════════════════════════════
-- STEP 1: CREATE TABLES
-- ════════════════════════════════════════════════════════════


-- ── 1.1 organizations ─────────────────────────────────────
-- Top-level tenant. Every row in every business table traces
-- back to exactly one organization. This is the hard isolation
-- boundary — no cross-organization data access is permitted.
-- ───────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 1.2 branches ──────────────────────────────────────────
-- Physical or logical locations within an organization.
-- Used for branch-level data restriction: non-admin users
-- only see data belonging to their assigned branch.
-- ───────────────────────────────────────────────────────────

CREATE TABLE branches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  location         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_organization_id
  ON branches (organization_id);


-- ── 1.3 users ─────────────────────────────────────────────
-- Business-logic user profile. The primary key references
-- auth.users(id) so every row is 1:1 with a Supabase Auth
-- account. This table does NOT store passwords — Supabase
-- Auth handles all credential management.
--
-- role values:
--   organization_admin — full access across all branches
--   admin              — branch-level management
--   estimator          — create/edit work within branch
--   viewer             — read-only within branch
--
-- status values:
--   pending — invited but has not yet registered
--   active  — registered and usable
-- ───────────────────────────────────────────────────────────

CREATE TABLE users (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  full_name        TEXT,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id        UUID REFERENCES branches(id) ON DELETE SET NULL,
  role             TEXT NOT NULL
                     CHECK (role IN ('organization_admin', 'admin', 'estimator', 'viewer')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active')),
  invited_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_organization_id ON users (organization_id);
CREATE INDEX idx_users_branch_id       ON users (branch_id);
CREATE INDEX idx_users_email           ON users (email);


-- ════════════════════════════════════════════════════════════
-- STEP 2: ENABLE ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- STEP 3: HELPER FUNCTIONS
-- ════════════════════════════════════════════════════════════
-- Reusable SECURITY DEFINER functions called inside RLS
-- policies. They run as the function owner (postgres) to
-- avoid infinite recursion when querying the users table
-- which itself has RLS enabled.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.users
  WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id
  FROM public.users
  WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE id = auth.uid()
$$;


-- ════════════════════════════════════════════════════════════
-- STEP 4: RLS POLICIES — organizations
-- ════════════════════════════════════════════════════════════

-- SELECT: user sees only their own organization
CREATE POLICY "organizations_select_own"
  ON organizations FOR SELECT
  USING ( id = public.get_my_organization_id() );

-- UPDATE: only organization_admin can edit org details
CREATE POLICY "organizations_update_own"
  ON organizations FOR UPDATE
  USING (
    id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  )
  WITH CHECK (
    id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  );

-- INSERT/DELETE: handled via service_role in application layer
-- (org creation during signup, org deletion is a rare admin action)


-- ════════════════════════════════════════════════════════════
-- STEP 5: RLS POLICIES — branches
-- ════════════════════════════════════════════════════════════

-- SELECT: all users see branches in their org
CREATE POLICY "branches_select_org"
  ON branches FOR SELECT
  USING ( organization_id = public.get_my_organization_id() );

-- INSERT: organization_admin only
CREATE POLICY "branches_insert_org_admin"
  ON branches FOR INSERT
  WITH CHECK (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  );

-- UPDATE: organization_admin only
CREATE POLICY "branches_update_org_admin"
  ON branches FOR UPDATE
  USING (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  )
  WITH CHECK (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  );

-- DELETE: organization_admin only
CREATE POLICY "branches_delete_org_admin"
  ON branches FOR DELETE
  USING (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
  );


-- ════════════════════════════════════════════════════════════
-- STEP 6: RLS POLICIES — users
-- ════════════════════════════════════════════════════════════

-- SELECT: see all users within same organization
CREATE POLICY "users_select_org"
  ON users FOR SELECT
  USING ( organization_id = public.get_my_organization_id() );

-- INSERT: organization_admin or admin can invite
CREATE POLICY "users_insert_org_admin"
  ON users FOR INSERT
  WITH CHECK (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() IN ('organization_admin', 'admin')
  );

-- UPDATE: admins can update any user in org; regular users can update their own row
CREATE POLICY "users_update_self_or_admin"
  ON users FOR UPDATE
  USING (
    organization_id = public.get_my_organization_id()
    AND (
      id = auth.uid()
      OR public.get_my_role() IN ('organization_admin', 'admin')
    )
  )
  WITH CHECK (
    organization_id = public.get_my_organization_id()
  );

-- DELETE: organization_admin only, cannot delete self
CREATE POLICY "users_delete_org_admin"
  ON users FOR DELETE
  USING (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() = 'organization_admin'
    AND id <> auth.uid()
  );


-- ════════════════════════════════════════════════════════════
-- STEP 7: TEMPLATE — Business Table with Branch-Level RLS
-- ════════════════════════════════════════════════════════════
-- "projects" is a real table AND a template. Copy this exact
-- pattern for every future business table (estimates,
-- scaffold_configs, drawings, etc.).
--
-- Branch restriction logic:
--   organization_admin → sees ALL branches in org
--   everyone else      → sees ONLY their own branch
-- ════════════════════════════════════════════════════════════

CREATE TABLE projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_organization_id ON projects (organization_id);
CREATE INDEX idx_projects_branch_id       ON projects (branch_id);
CREATE INDEX idx_projects_created_by      ON projects (created_by);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- SELECT: org isolation + branch gate
CREATE POLICY "projects_select"
  ON projects FOR SELECT
  USING (
    organization_id = public.get_my_organization_id()
    AND (
      public.get_my_role() = 'organization_admin'
      OR branch_id = public.get_my_branch_id()
    )
  );

-- INSERT: estimator+ can create; org_admin any branch, others own branch
CREATE POLICY "projects_insert"
  ON projects FOR INSERT
  WITH CHECK (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() IN ('organization_admin', 'admin', 'estimator')
    AND (
      public.get_my_role() = 'organization_admin'
      OR branch_id = public.get_my_branch_id()
    )
  );

-- UPDATE: same write scope, viewer excluded
CREATE POLICY "projects_update"
  ON projects FOR UPDATE
  USING (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() IN ('organization_admin', 'admin', 'estimator')
    AND (
      public.get_my_role() = 'organization_admin'
      OR branch_id = public.get_my_branch_id()
    )
  )
  WITH CHECK (
    organization_id = public.get_my_organization_id()
    AND (
      public.get_my_role() = 'organization_admin'
      OR branch_id = public.get_my_branch_id()
    )
  );

-- DELETE: admin+ only
CREATE POLICY "projects_delete"
  ON projects FOR DELETE
  USING (
    organization_id = public.get_my_organization_id()
    AND public.get_my_role() IN ('organization_admin', 'admin')
    AND (
      public.get_my_role() = 'organization_admin'
      OR branch_id = public.get_my_branch_id()
    )
  );


-- ════════════════════════════════════════════════════════════
-- STEP 8: FIRST USER SIGNUP FLOW
-- ════════════════════════════════════════════════════════════
--
-- When the first user of a new company signs up, the backend
-- must run these steps in a SINGLE TRANSACTION via service_role
-- (which bypasses RLS):
--
--   1. User registers via Supabase Auth → returns auth UUID
--
--   2. Create org:
--      INSERT INTO organizations (name)
--      VALUES ('会社名')
--      RETURNING id;                    -- → org_id
--
--   3. Create default branch:
--      INSERT INTO branches (organization_id, name)
--      VALUES (org_id, '本社')
--      RETURNING id;                    -- → branch_id
--
--   4. Create user profile:
--      INSERT INTO users (id, email, full_name, organization_id, branch_id, role, status)
--      VALUES (auth_uid, email, name, org_id, branch_id, 'organization_admin', 'active');
--
--   All 3 inserts MUST use service_role because the user has
--   no profile row yet and would fail every RLS check.
--
-- ════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- STEP 9: INVITE FLOW STRUCTURE
-- ════════════════════════════════════════════════════════════
--
-- PHASE 1 — INVITE (by organization_admin or admin)
-- ─────────────────────────────────────────────────────
--
--   a) Backend (service_role) creates a placeholder row:
--
--      INSERT INTO users (id, email, role, organization_id, branch_id, status, invited_by)
--      VALUES (
--        gen_random_uuid(),        -- temporary; will be replaced
--        'invitee@example.com',
--        'estimator',
--        <org_id>,
--        <branch_id>,
--        'pending',
--        <inviter auth.uid()>
--      );
--
--   b) App sends invite email (Supabase inviteUserByEmail
--      or custom magic link).
--
-- PHASE 2 — REGISTRATION (by the invited user)
-- ─────────────────────────────────────────────────────
--
--   a) Invitee clicks link → registers via Supabase Auth
--      → gets a real auth UUID.
--
--   b) Backend (service_role) activates the profile:
--
--      -- Delete placeholder, re-insert with real auth id
--      DELETE FROM users
--      WHERE email = 'invitee@example.com' AND status = 'pending'
--      RETURNING organization_id, branch_id, role, invited_by;
--
--      INSERT INTO users (id, email, full_name, organization_id, branch_id, role, status, invited_by)
--      VALUES (<real auth.uid()>, email, name, org_id, branch_id, role, 'active', invited_by);
--
--   Both phases run via service_role to bypass RLS.
--
-- ════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- VERIFICATION
-- ════════════════════════════════════════════════════════════

SELECT '✅ Multi-tenant SaaS schema created successfully!' AS status;

SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'branches', 'users', 'projects')
ORDER BY tablename;

SELECT
  schemaname || '.' || tablename AS "table",
  policyname AS policy,
  cmd AS operation
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'branches', 'users', 'projects')
ORDER BY tablename, cmd;
