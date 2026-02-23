-- ============================================================
-- Migration 018: Enable RLS on quotation_cost_items table
-- Fixes: rls_disabled_in_public for quotation_cost_items
-- ============================================================
-- Same pattern as 013: NestJS backend uses service_role key
-- which bypasses RLS. No policies needed.
-- ============================================================

ALTER TABLE quotation_cost_items ENABLE ROW LEVEL SECURITY;
