-- 108_stripe_subscriptions.sql
-- Stripe subscription + 14-day free trial support

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES companies(id) ON DELETE SET NULL,
  stripe_customer_id text NULL,
  stripe_subscription_id text NULL,
  stripe_price_id text NULL,
  plan text NOT NULL DEFAULT 'free_trial',
  status text NOT NULL DEFAULT 'trialing',
  trial_start timestamptz NULL,
  trial_end timestamptz NULL,
  current_period_start timestamptz NULL,
  current_period_end timestamptz NULL,
  cancel_at timestamptz NULL,
  canceled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Backfill existing users with default subscriptions
INSERT INTO subscriptions (user_id, company_id, plan, status, trial_start, trial_end)
SELECT u.id, u.company_id, 'free_trial', 'trialing', now(), now() + interval '14 day'
FROM users u
WHERE u.role <> 'superadmin'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO subscriptions (user_id, company_id, plan, status, current_period_start)
SELECT u.id, u.company_id, 'enterprise', 'active', now()
FROM users u
WHERE u.role = 'superadmin'
ON CONFLICT (user_id) DO NOTHING;
