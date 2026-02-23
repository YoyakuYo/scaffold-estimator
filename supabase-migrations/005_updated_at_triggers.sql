-- ============================================================
-- Migration 005: Auto-update "updated_at" Triggers
-- Run this FIFTH in Supabase SQL Editor
-- ============================================================
-- Supabase / PostgreSQL doesn't auto-update updated_at like
-- TypeORM does in the app layer. These triggers keep it in
-- sync even for direct SQL / RPC updates.

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

-- companies
DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- users
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- drawings
DROP TRIGGER IF EXISTS trg_drawings_updated_at ON drawings;
CREATE TRIGGER trg_drawings_updated_at
  BEFORE UPDATE ON drawings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- estimates
DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- cost_line_items
DROP TRIGGER IF EXISTS trg_cost_line_items_updated_at ON cost_line_items;
CREATE TRIGGER trg_cost_line_items_updated_at
  BEFORE UPDATE ON cost_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- cost_master_data
DROP TRIGGER IF EXISTS trg_cost_master_data_updated_at ON cost_master_data;
CREATE TRIGGER trg_cost_master_data_updated_at
  BEFORE UPDATE ON cost_master_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
