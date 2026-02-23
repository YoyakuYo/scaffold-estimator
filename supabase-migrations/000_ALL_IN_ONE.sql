-- ============================================================
-- SCAFFOLDING ESTIMATION PLATFORM — FULL DATABASE SCHEMA
-- ============================================================
-- Copy this entire file into the Supabase SQL Editor and run.
-- It creates all 9 tables, enums, indexes, triggers, RLS
-- policies, and seed data in a single execution.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PART 1: EXTENSIONS
-- ════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ════════════════════════════════════════════════════════════
-- PART 2: ENUM TYPES
-- ════════════════════════════════════════════════════════════
DO $$ BEGIN CREATE TYPE user_role           AS ENUM ('admin', 'estimator', 'viewer');                                     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE drawing_file_format AS ENUM ('pdf', 'dxf', 'dwg');                                               EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE drawing_upload_status AS ENUM ('pending', 'processing', 'completed', 'failed');                  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE structure_type      AS ENUM ('改修工事', 'S造', 'RC造');                                            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE rental_period_type  AS ENUM ('weekly', 'monthly', 'custom');                                      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estimate_status     AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'finalized');    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE cost_category       AS ENUM ('basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE geometry_element_type AS ENUM ('line', 'polyline', 'arc', 'circle', 'polygon', 'text', 'dimension'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE export_format       AS ENUM ('pdf', 'excel');                                                     EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ════════════════════════════════════════════════════════════
-- PART 3: TABLES
-- ════════════════════════════════════════════════════════════

-- ── 1. companies ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  tax_id        VARCHAR(50),
  address       TEXT,
  phone         VARCHAR(50),
  email         VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            user_role NOT NULL DEFAULT 'viewer',
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_users_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ── 3. drawings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drawings (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id                    UUID NOT NULL,
  filename                      VARCHAR(255) NOT NULL,
  file_format                   drawing_file_format NOT NULL,
  file_path                     VARCHAR(512) NOT NULL,
  file_size_bytes               BIGINT NOT NULL,
  uploaded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by                   UUID NOT NULL,
  metadata                      JSONB,
  detected_structure_type       VARCHAR(50),
  user_confirmed_structure_type VARCHAR(50),
  normalized_geometry           JSONB,
  upload_status                 drawing_upload_status NOT NULL DEFAULT 'pending',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

-- ── 4. geometry_elements ───────────────────────────────────
CREATE TABLE IF NOT EXISTS geometry_elements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  drawing_id        UUID NOT NULL,
  element_type      geometry_element_type NOT NULL,
  coordinates       JSONB NOT NULL,
  layer_name        VARCHAR(255),
  properties        JSONB,
  extracted_length  DECIMAL(10, 2),
  extracted_area    DECIMAL(15, 2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_geometry_elements_drawing
    FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE
);

-- ── 5. estimates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimates (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id            UUID NOT NULL,
  drawing_id            UUID NOT NULL,
  structure_type        structure_type NOT NULL,
  rental_start_date     DATE NOT NULL,
  rental_end_date       DATE NOT NULL,
  rental_type           rental_period_type NOT NULL,
  bill_of_materials     JSONB NOT NULL,
  total_estimated_cost  DECIMAL(15, 2),
  status                estimate_status NOT NULL DEFAULT 'draft',
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at          TIMESTAMPTZ,
  CONSTRAINT fk_estimates_drawing
    FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE SET NULL
);

-- ── 6. cost_line_items ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_line_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  estimate_id         UUID NOT NULL,
  code                VARCHAR(20) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  category            cost_category NOT NULL,
  formula_expression  TEXT NOT NULL,
  formula_variables   JSONB NOT NULL,
  computed_value      DECIMAL(15, 2) NOT NULL DEFAULT 0,
  user_edited_value   DECIMAL(15, 2),
  is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
  edited_by           UUID,
  edited_at           TIMESTAMPTZ,
  edit_reason         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_cost_line_items_estimate
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE
);

-- ── 7. cost_master_data ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_master_data (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category                  cost_category NOT NULL,
  region                    VARCHAR(50) NOT NULL,
  fiscal_year               INT NOT NULL,
  material_basic_rate       DECIMAL(10, 2),
  damage_rate               DECIMAL(10, 2),
  transport_rate            DECIMAL(10, 2),
  cleaning_rate             DECIMAL(10, 2),
  repair_rate               DECIMAL(5, 2),
  wear_rate_percent         DECIMAL(5, 2),
  disposal_rate_percent     DECIMAL(5, 2),
  surface_prep_rate_percent DECIMAL(5, 2),
  audit_log                 JSONB,
  created_by                UUID NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. estimate_exports ────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_exports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  estimate_id     UUID NOT NULL,
  export_format   export_format NOT NULL,
  file_path       VARCHAR(512),
  file_size_bytes BIGINT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by    UUID NOT NULL,
  s3_url          VARCHAR(1024),
  expires_at      TIMESTAMPTZ,
  CONSTRAINT fk_estimate_exports_estimate
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE
);

-- ── 9. audit_log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type   VARCHAR(50) NOT NULL,
  entity_id     UUID NOT NULL,
  action        VARCHAR(50) NOT NULL,
  user_id       UUID NOT NULL,
  old_values    JSONB,
  new_values    JSONB,
  "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address    INET
);


-- ════════════════════════════════════════════════════════════
-- PART 4: INDEXES
-- ════════════════════════════════════════════════════════════

-- users
CREATE INDEX IF NOT EXISTS idx_users_email       ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_company_id  ON users (company_id);

-- drawings
CREATE INDEX IF NOT EXISTS idx_drawings_project_uploaded ON drawings (project_id, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_drawings_uploaded_by      ON drawings (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_drawings_upload_status    ON drawings (upload_status);

-- geometry_elements
CREATE INDEX IF NOT EXISTS idx_geometry_drawing_layer ON geometry_elements (drawing_id, layer_name);

-- estimates
CREATE INDEX IF NOT EXISTS idx_estimates_project_id  ON estimates (project_id);
CREATE INDEX IF NOT EXISTS idx_estimates_drawing_id  ON estimates (drawing_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status       ON estimates (status);
CREATE INDEX IF NOT EXISTS idx_estimates_created_by   ON estimates (created_by);

-- cost_line_items
CREATE INDEX IF NOT EXISTS idx_cost_items_estimate_category ON cost_line_items (estimate_id, category);

-- cost_master_data (unique composite)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_master_category_region_year ON cost_master_data (category, region, fiscal_year);

-- estimate_exports
CREATE INDEX IF NOT EXISTS idx_exports_estimate_id ON estimate_exports (estimate_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_entity    ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log ("timestamp");
CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_log (user_id);


-- ════════════════════════════════════════════════════════════
-- PART 5: AUTO-UPDATE "updated_at" TRIGGERS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_updated_at       ON companies;
CREATE TRIGGER trg_companies_updated_at       BEFORE UPDATE ON companies       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_users_updated_at           ON users;
CREATE TRIGGER trg_users_updated_at           BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_drawings_updated_at        ON drawings;
CREATE TRIGGER trg_drawings_updated_at        BEFORE UPDATE ON drawings        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_estimates_updated_at       ON estimates;
CREATE TRIGGER trg_estimates_updated_at       BEFORE UPDATE ON estimates       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_cost_line_items_updated_at ON cost_line_items;
CREATE TRIGGER trg_cost_line_items_updated_at BEFORE UPDATE ON cost_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_cost_master_data_updated_at ON cost_master_data;
CREATE TRIGGER trg_cost_master_data_updated_at BEFORE UPDATE ON cost_master_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ════════════════════════════════════════════════════════════
-- PART 6: ROW LEVEL SECURITY (RLS)
-- ════════════════════════════════════════════════════════════
-- RLS is enabled on all tables for security best practices.
-- The NestJS backend uses the service_role key which automatically
-- bypasses RLS, so no policies are needed.
-- 
-- If you later add Supabase Auth or direct client access,
-- you can add proper RLS policies at that time.

ALTER TABLE companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE geometry_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_master_data  ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_exports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed: service_role bypasses RLS automatically


-- ════════════════════════════════════════════════════════════
-- PART 7: SEED DATA
-- ════════════════════════════════════════════════════════════

-- Default company
INSERT INTO companies (id, name, tax_id, address, phone, email)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'デフォルト建設株式会社',
  '1234567890123',
  '東京都千代田区1-1-1',
  '03-1234-5678',
  'info@example.com'
) ON CONFLICT DO NOTHING;

-- Admin user (password: admin123)
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'admin@example.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36PqSmFhddC3TpOEatg4nGy',
  'admin', 'Admin', 'User', TRUE
) ON CONFLICT (email) DO NOTHING;

-- Estimator user (password: estimator123)
INSERT INTO users (id, company_id, email, password_hash, role, first_name, last_name, is_active)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'estimator@example.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36PqSmFhddC3TpOEatg4nGy',
  'estimator', 'Estimator', 'User', TRUE
) ON CONFLICT (email) DO NOTHING;

-- Cost master data for 東京 (current fiscal year)
INSERT INTO cost_master_data (category, region, fiscal_year, material_basic_rate, damage_rate, transport_rate, cleaning_rate, repair_rate, wear_rate_percent, disposal_rate_percent, surface_prep_rate_percent, created_by)
VALUES
  ('basic_charge',  '東京', EXTRACT(YEAR FROM NOW())::INT, 5000.00, NULL,   NULL,   NULL,   NULL, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  ('damage_charge', '東京', EXTRACT(YEAR FROM NOW())::INT, NULL,    150.00, NULL,   NULL,   NULL, 1.00, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  ('transport',     '東京', EXTRACT(YEAR FROM NOW())::INT, NULL,    NULL,   500.00, NULL,   NULL, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001'),
  ('loss',          '東京', EXTRACT(YEAR FROM NOW())::INT, NULL,    NULL,   NULL,   NULL,   NULL, NULL, 5.00, NULL, 'b0000000-0000-0000-0000-000000000001'),
  ('cleaning',      '東京', EXTRACT(YEAR FROM NOW())::INT, NULL,    NULL,   NULL,   300.00, NULL, NULL, NULL, 3.00, 'b0000000-0000-0000-0000-000000000001'),
  ('repair',        '東京', EXTRACT(YEAR FROM NOW())::INT, NULL,    NULL,   NULL,   NULL,   2.00, NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- VERIFICATION (check results after running)
-- ════════════════════════════════════════════════════════════
SELECT '✅ Schema created successfully!' AS status;

SELECT 'companies'         AS "table", COUNT(*) AS "rows" FROM companies
UNION ALL SELECT 'users',             COUNT(*) FROM users
UNION ALL SELECT 'cost_master_data',  COUNT(*) FROM cost_master_data
UNION ALL SELECT 'drawings',          COUNT(*) FROM drawings
UNION ALL SELECT 'geometry_elements', COUNT(*) FROM geometry_elements
UNION ALL SELECT 'estimates',         COUNT(*) FROM estimates
UNION ALL SELECT 'cost_line_items',   COUNT(*) FROM cost_line_items
UNION ALL SELECT 'estimate_exports',  COUNT(*) FROM estimate_exports
UNION ALL SELECT 'audit_log',         COUNT(*) FROM audit_log;
