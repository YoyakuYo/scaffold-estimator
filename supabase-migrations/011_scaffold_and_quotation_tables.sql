-- ============================================================
-- Migration 011: Create scaffold configuration, calculated
-- quantities, quotation, and quotation items tables
-- ============================================================

-- 1. Scaffold Configurations
CREATE TABLE IF NOT EXISTS scaffold_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR(255) NOT NULL,
  drawing_id UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  structure_type VARCHAR(20) NOT NULL,     -- 'RC造', 'S造', '改修工事'
  scaffold_type VARCHAR(20) NOT NULL,      -- 'frame', 'single_pipe', 'next_gen'
  total_facade_length DECIMAL(10,2) NOT NULL,
  building_height DECIMAL(10,2) NOT NULL,
  span_spacing DECIMAL(10,2) NOT NULL DEFAULT 1.8,
  level_height DECIMAL(10,2) NOT NULL DEFAULT 1.7,
  rental_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
  rental_start_date DATE,
  rental_end_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'configured',  -- 'configured', 'calculated', 'reviewed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scaffold_config_drawing ON scaffold_configurations(drawing_id);
CREATE INDEX IF NOT EXISTS idx_scaffold_config_project ON scaffold_configurations(project_id);

-- 2. Calculated Quantities
CREATE TABLE IF NOT EXISTS calculated_quantities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES scaffold_configurations(id) ON DELETE CASCADE,
  component_type VARCHAR(50) NOT NULL,
  component_name VARCHAR(100) NOT NULL,
  size_spec VARCHAR(50) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  calculated_quantity INT NOT NULL,
  adjusted_quantity INT,
  adjustment_reason TEXT,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calc_qty_config ON calculated_quantities(config_id);

-- 3. Quotations
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR(255) NOT NULL,
  config_id UUID NOT NULL REFERENCES scaffold_configurations(id) ON DELETE CASCADE,
  title VARCHAR(200),
  rental_start_date DATE NOT NULL,
  rental_end_date DATE NOT NULL,
  rental_type VARCHAR(20) NOT NULL,
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

-- 4. Quotation Items
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

-- 5. Enable Row Level Security (optional, but good practice)
-- ALTER TABLE scaffold_configurations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE calculated_quantities ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
