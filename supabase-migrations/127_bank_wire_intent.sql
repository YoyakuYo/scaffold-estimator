-- Wire-transfer memo code + chosen plan (billing page); superadmin confirms payment in admin UI.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_wire_reference TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_wire_intent_plan TEXT
  CHECK (bank_wire_intent_plan IS NULL OR bank_wire_intent_plan IN ('basic', 'medium', 'premium'));

CREATE UNIQUE INDEX IF NOT EXISTS users_bank_wire_reference_unique
  ON users (bank_wire_reference)
  WHERE bank_wire_reference IS NOT NULL;

COMMENT ON COLUMN users.bank_wire_reference IS 'Unique transfer memo / reference code for matching incoming wires (bank checkout).';
COMMENT ON COLUMN users.bank_wire_intent_plan IS 'Plan tier the customer selected for the pending wire; cleared after admin confirms.';
