-- ============================================================
-- Migration 004: Create All Indexes
-- Run this FOURTH in Supabase SQL Editor
-- ============================================================

-- ── users indexes ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_company_id
  ON users (company_id);

-- ── drawings indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_drawings_project_uploaded
  ON drawings (project_id, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_drawings_uploaded_by
  ON drawings (uploaded_by);

CREATE INDEX IF NOT EXISTS idx_drawings_upload_status
  ON drawings (upload_status);

-- ── geometry_elements indexes ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_geometry_drawing_layer
  ON geometry_elements (drawing_id, layer_name);

-- ── estimates indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_estimates_project_id
  ON estimates (project_id);

CREATE INDEX IF NOT EXISTS idx_estimates_drawing_id
  ON estimates (drawing_id);

CREATE INDEX IF NOT EXISTS idx_estimates_status
  ON estimates (status);

CREATE INDEX IF NOT EXISTS idx_estimates_created_by
  ON estimates (created_by);

-- ── cost_line_items indexes ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cost_items_estimate_category
  ON cost_line_items (estimate_id, category);

-- ── cost_master_data indexes ───────────────────────────────
-- Unique composite index prevents duplicate rates per category/region/year
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_master_category_region_year
  ON cost_master_data (category, region, fiscal_year);

-- ── estimate_exports indexes ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_exports_estimate_id
  ON estimate_exports (estimate_id);

-- ── audit_log indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON audit_log ("timestamp");

CREATE INDEX IF NOT EXISTS idx_audit_user_id
  ON audit_log (user_id);
