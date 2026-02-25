-- ============================================================
-- Migration 109: Restore cost_master_data (and cost_category enum)
-- ============================================================
-- 100_multi_tenant_saas.sql drops cost_master_data and cost_category
-- but does not recreate them. Quotation cost calculation requires
-- this table. Run this after 100 on any environment that uses
-- quotations (e.g. Render + Supabase).
-- ============================================================

-- 1. Recreate enum if it was dropped by 100
DO $$ BEGIN
  CREATE TYPE cost_category AS ENUM (
    'basic_charge', 'damage_charge', 'transport', 'loss',
    'cleaning', 'repair', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create cost_master_data table
CREATE TABLE IF NOT EXISTS cost_master_data (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category                  cost_category NOT NULL,
  region                    VARCHAR(50) NOT NULL,
  fiscal_year               INT NOT NULL,
  material_basic_rate        DECIMAL(10, 2),
  damage_rate               DECIMAL(10, 2),
  transport_rate            DECIMAL(10, 2),
  cleaning_rate             DECIMAL(10, 2),
  repair_rate               DECIMAL(5, 2),
  wear_rate_percent         DECIMAL(5, 2),
  disposal_rate_percent     DECIMAL(5, 2),
  surface_prep_rate_percent DECIMAL(5, 2),
  audit_log                  JSONB,
  created_by                UUID NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Unique index for one config per category/region/year
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_master_category_region_year
  ON cost_master_data (category, region, fiscal_year);

-- RLS: backend uses service_role and bypasses RLS; enable for consistency
ALTER TABLE cost_master_data ENABLE ROW LEVEL SECURITY;

-- 4. Optional seed: insert default rates for current year if table is empty
--    Uses first existing user as created_by (safe for multi-tenant).
INSERT INTO cost_master_data (
  category, region, fiscal_year,
  material_basic_rate, damage_rate, transport_rate, cleaning_rate,
  repair_rate, wear_rate_percent, disposal_rate_percent, surface_prep_rate_percent,
  created_by
)
SELECT
  c.cat,
  '東京',
  EXTRACT(YEAR FROM now())::INT,
  CASE c.cat WHEN 'basic_charge' THEN 5000.00 ELSE NULL END,
  CASE c.cat WHEN 'damage_charge' THEN 150.00 ELSE NULL END,
  CASE c.cat WHEN 'transport' THEN 500.00 ELSE NULL END,
  CASE c.cat WHEN 'cleaning' THEN 300.00 ELSE NULL END,
  CASE c.cat WHEN 'repair' THEN 2.00 ELSE NULL END,
  CASE c.cat WHEN 'damage_charge' THEN 1.00 ELSE NULL END,
  CASE c.cat WHEN 'loss' THEN 5.00 ELSE NULL END,
  CASE c.cat WHEN 'cleaning' THEN 3.00 ELSE NULL END,
  u.id
FROM (VALUES
  ('basic_charge'::cost_category),
  ('damage_charge'::cost_category),
  ('transport'::cost_category),
  ('loss'::cost_category),
  ('cleaning'::cost_category),
  ('repair'::cost_category),
  ('other'::cost_category)
) AS c(cat)
CROSS JOIN (SELECT id FROM users LIMIT 1) AS u
WHERE EXISTS (SELECT 1 FROM users LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM cost_master_data LIMIT 1)
ON CONFLICT DO NOTHING;

-- (idx_cost_master_category_region_year is unique on category, region, fiscal_year;
--  we didn't add a unique constraint name for ON CONFLICT, so we rely on the unique index.
--  PostgreSQL uses the unique index for ON CONFLICT when no constraint name is given only
--  if the conflict target is specified. So we need to add ON CONFLICT (category, region, fiscal_year) DO NOTHING.)
-- Fix: add explicit conflict target
</think>
Fixing the seed: use ON CONFLICT (category, region, fiscal_year) for the unique index.
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace