-- Phase 2 — multi-product platform refactor.
-- Subscriptions become per-product instead of per-user. Each user/company can hold one
-- row per product (scaffold / bim / construction_plan), priced and trialed independently.
-- Existing rows keep working as-is by being labelled `scaffold` (the original product).

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product_code text NOT NULL DEFAULT 'scaffold';

-- Backfill any null product_code (defensive — DEFAULT covers new + existing rows already).
UPDATE public.subscriptions
SET product_code = 'scaffold'
WHERE product_code IS NULL OR product_code = '';

-- The previous schema had `user_id UNIQUE`. Drop it so multiple subscription rows per
-- user (one per product) become possible, and replace with a composite unique index.
DO $$
DECLARE
  cn text;
BEGIN
  SELECT conname INTO cn
  FROM pg_constraint
  WHERE conrelid = 'public.subscriptions'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(user_id)%'
  LIMIT 1;
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT %I', cn);
  END IF;
END$$;

-- Drop the legacy single-column unique index too (idempotent).
DROP INDEX IF EXISTS subscriptions_user_id_key;
DROP INDEX IF EXISTS public.subscriptions_user_id_idx;

-- Composite unique key: at most one subscription row per (user, product).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_product_idx
  ON public.subscriptions (user_id, product_code);

-- Index for common filter: capabilities by product across an entire company.
CREATE INDEX IF NOT EXISTS subscriptions_company_product_idx
  ON public.subscriptions (company_id, product_code);

CREATE INDEX IF NOT EXISTS subscriptions_product_idx
  ON public.subscriptions (product_code);
