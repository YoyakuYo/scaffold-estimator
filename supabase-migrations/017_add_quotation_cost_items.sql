-- ============================================================
-- Migration 017: Add cost items table and update quotations table
-- ============================================================

-- 1. Create quotation_cost_items table
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

-- 2. Add new columns to quotations table
DO $$
BEGIN
  -- Add material_subtotal column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotations' 
    AND column_name = 'material_subtotal'
  ) THEN
    ALTER TABLE quotations 
    ADD COLUMN material_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0;
    
    COMMENT ON COLUMN quotations.material_subtotal IS 
      'Subtotal of material costs (quantity × unit price)';
  END IF;

  -- Add cost_subtotal column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotations' 
    AND column_name = 'cost_subtotal'
  ) THEN
    ALTER TABLE quotations 
    ADD COLUMN cost_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0;
    
    COMMENT ON COLUMN quotations.cost_subtotal IS 
      'Subtotal of rental period-based costs (6 categories: 仮設材基本料, 仮設材損料, 運搬費, 滅失費, ケレン費, 修理代金)';
  END IF;

  -- Update existing subtotal to be material_subtotal if cost_subtotal is 0
  UPDATE quotations 
  SET material_subtotal = subtotal 
  WHERE material_subtotal = 0 AND subtotal > 0;
END $$;
