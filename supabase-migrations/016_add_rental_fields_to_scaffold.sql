-- ============================================================
-- Migration 016: Add optional rental period fields to scaffold_configurations
-- ============================================================

-- Add rental period fields if they don't exist
DO $$
BEGIN
  -- Add rental_type column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'rental_type'
  ) THEN
    ALTER TABLE scaffold_configurations 
    ADD COLUMN rental_type VARCHAR(20) NULL;
    
    COMMENT ON COLUMN scaffold_configurations.rental_type IS 
      'Rental period type: weekly, monthly, custom (optional - can be set in quotation instead)';
  END IF;

  -- Add rental_start_date column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'rental_start_date'
  ) THEN
    ALTER TABLE scaffold_configurations 
    ADD COLUMN rental_start_date DATE NULL;
    
    COMMENT ON COLUMN scaffold_configurations.rental_start_date IS 
      'Rental period start date (optional - can be set in quotation instead)';
  END IF;

  -- Add rental_end_date column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scaffold_configurations' 
    AND column_name = 'rental_end_date'
  ) THEN
    ALTER TABLE scaffold_configurations 
    ADD COLUMN rental_end_date DATE NULL;
    
    COMMENT ON COLUMN scaffold_configurations.rental_end_date IS 
      'Rental period end date (optional - can be set in quotation instead)';
  END IF;
END $$;
