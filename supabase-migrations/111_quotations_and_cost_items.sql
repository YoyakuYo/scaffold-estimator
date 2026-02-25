-- ============================================================
-- Migration 111: Recreate quotations, quotation_items, quotation_cost_items
-- ============================================================
-- Migration 100 drops these tables; 105 recreates scaffold_configs
-- but not quotation tables. This restores them so quotation create works.
-- Run after 105 (and 109 if using cost_master_data).
-- ============================================================

-- 1. Quotations (config_id references scaffold_configs from 105)
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR(255) NOT NULL,
  config_id UUID NOT NULL REFERENCES scaffold_configs(id) ON DELETE CASCADE,
  title VARCHAR(200),
  rental_start_date DATE NOT NULL,
  rental_end_date DATE NOT NULL,
  rental_type VARCHAR(20) NOT NULL,
  material_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  cost_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES users(id),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_project ON quotations(project_id);
CREATE INDEX IF NOT EXISTS idx_quotation_config ON quotations(config_id);

-- 2. Quotation items (line items per quotation)
CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  component_type VARCHAR(50) NOT NULL,
  component_name VARCHAR(100) NOT NULL,
  size_spec VARCHAR(50) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(15,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);

-- 3. Quotation cost items (rental-period cost categories per quotation)
CREATE TABLE IF NOT EXISTS quotation_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair')),
  formula_expression TEXT,
  formula_variables JSONB,
  calculated_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  user_edited_value DECIMAL(15,2),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_cost_items_quotation ON quotation_cost_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_cost_items_category ON quotation_cost_items(quotation_id, category);

-- 4. RLS (optional; backend often uses service_role)
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_cost_items ENABLE ROW LEVEL SECURITY;
