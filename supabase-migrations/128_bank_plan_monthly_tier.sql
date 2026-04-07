-- Allow `monthly` paid tier (¥25k/mo wire) on user bank fields.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pending_bank_plan_check;
ALTER TABLE users ADD CONSTRAINT users_pending_bank_plan_check
  CHECK (pending_bank_plan IS NULL OR pending_bank_plan IN ('basic', 'medium', 'premium', 'monthly'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_bank_wire_intent_plan_check;
ALTER TABLE users ADD CONSTRAINT users_bank_wire_intent_plan_check
  CHECK (bank_wire_intent_plan IS NULL OR bank_wire_intent_plan IN ('basic', 'medium', 'premium', 'monthly'));
