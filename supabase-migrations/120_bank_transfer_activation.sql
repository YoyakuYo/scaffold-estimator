-- Bank transfer subscription: superadmin assigns plan; user must verify one-time code before access.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_bank_plan TEXT
    CHECK (pending_bank_plan IS NULL OR pending_bank_plan IN ('basic', 'medium', 'premium'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_activation_code_hash TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_activation_code_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN users.pending_bank_plan IS 'Paid tier pending code entry after bank-transfer approval; NULL when not waiting on activation.';
COMMENT ON COLUMN users.bank_activation_code_hash IS 'SHA-256 hash of one-time activation code (with server pepper); never expose to clients.';
