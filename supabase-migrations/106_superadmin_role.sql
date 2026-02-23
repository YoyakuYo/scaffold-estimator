-- ============================================================
-- Migration 106: Introduce 'superadmin' as a first-class role
-- ============================================================
-- Updates the platform owner user from role='admin' to role='superadmin'.
-- The backend RolesGuard now auto-grants superadmin full access to all
-- admin-protected endpoints, so no per-endpoint changes are needed in SQL.
-- ============================================================

-- Force superadmin by email — always, regardless of current role
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE email = 'omarsowbarca45@gmail.com';

-- Also by fixed UUID (from migration 105)
UPDATE users
SET role = 'superadmin',
    updated_at = now()
WHERE id = 'b0000000-0000-0000-0000-000000000099'
  AND role != 'superadmin';

-- Verify
SELECT id, email, role, is_active, approval_status
FROM users
WHERE email = 'omarsowbarca45@gmail.com';
