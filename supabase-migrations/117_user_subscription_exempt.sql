-- Lifetime / comp accounts: full product access without Stripe (checked in backend SubscriptionService).
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.subscription_exempt IS 'When true, user bypasses subscription/trial gates (same entitlements as superadmin for billing features).';
