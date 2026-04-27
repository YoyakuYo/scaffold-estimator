-- Phase 2 follow-up (gap #2): per-product bank-transfer activation.
-- The two pre-existing pending columns on `users` (pending_bank_plan,
-- bank_wire_intent_plan) are scoped to one product at a time. Add a
-- product code so we can route the activation to scaffold / bim /
-- construction_plan independently. Default 'scaffold' preserves the
-- existing flow for any in-flight intents.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pending_bank_product_code text NOT NULL DEFAULT 'scaffold';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bank_wire_intent_product_code text NOT NULL DEFAULT 'scaffold';
