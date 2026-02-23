-- ============================================================
-- Migration 007: Seed Initial Data
-- Run this LAST in Supabase SQL Editor
-- ============================================================
-- Creates:
--   • 1 default company (デフォルト建設株式会社)
--   • 1 admin user      (admin@example.com / admin123)
--   • 1 estimator user  (estimator@example.com / estimator123)
--   • Cost master data for 東京 region (current fiscal year)
--
-- Passwords are bcrypt-hashed (cost factor 10).
-- ============================================================

-- ── 1. Default Company ─────────────────────────────────────
INSERT INTO companies (id, name, tax_id, address, phone, email)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'デフォルト建設株式会社',
  '1234567890123',
  '東京都千代田区1-1-1',
  '03-1234-5678',
  'info@example.com'
)
ON CONFLICT DO NOTHING;

-- ── 2. Admin User ──────────────────────────────────────────
-- Password: admin123  (bcrypt hash with cost 10)
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'admin@example.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36PqSmFhddC3TpOEatg4nGy',
  'admin',
  'Admin',
  'User',
  TRUE
)
ON CONFLICT (email) DO NOTHING;

-- ── 3. Estimator User ──────────────────────────────────────
-- Password: estimator123  (bcrypt hash with cost 10)
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'estimator@example.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36PqSmFhddC3TpOEatg4nGy',
  'estimator',
  'Estimator',
  'User',
  TRUE
)
ON CONFLICT (email) DO NOTHING;

-- ── 4. Cost Master Data for 東京 (current year) ────────────
-- One row per cost category so each category has its own rates
INSERT INTO cost_master_data (category, region, fiscal_year, material_basic_rate, damage_rate, transport_rate, cleaning_rate, repair_rate, wear_rate_percent, disposal_rate_percent, surface_prep_rate_percent, created_by)
VALUES
  -- 仮設材基本料 (Basic Charge)
  ('basic_charge', '東京', EXTRACT(YEAR FROM NOW())::INT, 5000.00, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  -- 仮設材損料 (Damage Charge / Depreciation)
  ('damage_charge', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL, 150.00, NULL, NULL, NULL, 1.00, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  -- 運搬費 (Transport)
  ('transport', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL, NULL, 500.00, NULL, NULL, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  -- 滅失費 (Loss / Disposal)
  ('loss', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL, NULL, NULL, NULL, NULL, NULL, 5.00, NULL, 'b0000000-0000-0000-0000-000000000001'),
  -- ケレン費 (Cleaning / Surface Prep)
  ('cleaning', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL, NULL, NULL, 300.00, NULL, NULL, NULL, 3.00, 'b0000000-0000-0000-0000-000000000001'),
  -- 修理代金 (Repair)
  ('repair', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL, NULL, NULL, NULL, 2.00, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ── Verification ───────────────────────────────────────────
-- Run these SELECTs to confirm everything was created:
SELECT 'companies' AS "table", COUNT(*) AS "rows" FROM companies
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'cost_master_data', COUNT(*) FROM cost_master_data
UNION ALL
SELECT 'drawings', COUNT(*) FROM drawings
UNION ALL
SELECT 'geometry_elements', COUNT(*) FROM geometry_elements
UNION ALL
SELECT 'estimates', COUNT(*) FROM estimates
UNION ALL
SELECT 'cost_line_items', COUNT(*) FROM cost_line_items
UNION ALL
SELECT 'estimate_exports', COUNT(*) FROM estimate_exports
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log;
