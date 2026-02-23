-- ============================================================
-- Migration 010: Change project_id from UUID to VARCHAR
-- This allows using string project IDs like "default-project"
-- ============================================================

-- Change project_id column in drawings table to VARCHAR
ALTER TABLE drawings 
  ALTER COLUMN project_id TYPE VARCHAR(255) 
  USING project_id::text;

-- Change project_id column in estimates table to VARCHAR (if it exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'estimates' AND column_name = 'project_id') THEN
    ALTER TABLE estimates 
      ALTER COLUMN project_id TYPE VARCHAR(255) 
      USING project_id::text;
  END IF;
END $$;
