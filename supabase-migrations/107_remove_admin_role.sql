-- ============================================================
-- Migration 107: Remove 'admin' role — only superadmin exists
-- ============================================================
-- Converts any remaining admin users to estimator.
-- The superadmin (omarsowbarca45@gmail.com) is untouched.
-- ============================================================

UPDATE users
SET role = 'estimator',
    updated_at = now()
WHERE role = 'admin';

-- Verify no admin users remain
SELECT id, email, role
FROM users
WHERE role = 'admin';
-- Expected: 0 rows
