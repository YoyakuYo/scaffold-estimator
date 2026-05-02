-- ============================================================
-- Migration 106: Introduce 'superadmin' as a first-class role
-- ============================================================
-- Historical note: Earlier versions promoted a fixed email/UUID here.
-- That is intentionally removed — do not assign platform operators in migrations.
--
-- Operators: promotion via Platform Console (/superadmin/console) as an existing
-- superadmin, or one-off bootstrap: backend `npm run bootstrap:superadmin` with
-- PLATFORM_BOOTSTRAP_SUPERADMIN_EMAIL in .env (see ENV_SETUP.md).
--
-- RolesGuard treats role = 'superadmin' as bypass for @Roles(...) checks.
-- ============================================================

SELECT 1;
