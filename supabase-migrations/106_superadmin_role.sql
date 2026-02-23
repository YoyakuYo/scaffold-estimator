-- ============================================================
-- Migration 106: Introduce 'superadmin' as a first-class role
-- ============================================================
-- Updates the platform owner user from role='admin' to role='superadmin'.
-- The backend RolesGuard now auto-grants superadmin full access to all
-- admin-protected endpoints, so no per-endpoint changes are needed in SQL.
-- ============================================================

-- Set the platform owner (from migration 105) to superadmin role
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE id = 'b0000000-0000-0000-0000-000000000099';

-- Also catch anyone who was inserted via email (in case id differs)
-- Only updates if the user belongs to the Platform Admin company
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE company_id = 'a0000000-0000-0000-0000-000000000001'
  AND role = 'admin';

-- Verify
SELECT id, email, role, is_active, approval_status
FROM users
WHERE role = 'superadmin';
