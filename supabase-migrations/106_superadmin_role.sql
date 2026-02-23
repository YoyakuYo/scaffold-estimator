-- ============================================================
-- Migration 106: Introduce 'superadmin' as a first-class role
-- ============================================================
-- Updates the platform owner user from role='admin' to role='superadmin'.
-- The backend RolesGuard now auto-grants superadmin full access to all
-- admin-protected endpoints, so no per-endpoint changes are needed in SQL.
-- ============================================================

-- Set by fixed UUID (from migration 105)
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE id = 'b0000000-0000-0000-0000-000000000099';

-- Set by email (in case UUID differs)
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE email = 'omarsowbarca45@gmail.com'
  AND role = 'admin';

-- Catch any other admin in the Platform Admin company
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE company_id = 'a0000000-0000-0000-0000-000000000001'
  AND role = 'admin';

-- Verify
SELECT id, email, role, is_active, approval_status
FROM users
WHERE role = 'superadmin';
