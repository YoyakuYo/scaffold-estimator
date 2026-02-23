-- ============================================================
-- Migration 003: Create All Tables
-- Run this THIRD in Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. companies
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 2. users
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 3. drawings
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 4. geometry_elements
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 5. estimates
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 6. cost_line_items
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 7. cost_master_data
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 8. estimate_exports
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 9. audit_log
-- ────────────────────────────────────────────────────────────
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
