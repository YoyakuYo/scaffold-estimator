-- Persist org seat holders (team invitees) so billing UI/API stays off even when peer Stripe detection lags.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_company_seat BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_company_seat ON public.users (company_id) WHERE is_company_seat = true;

-- Existing users: accepted a team invite to this company and have no personal Stripe customer/subscription.
UPDATE public.users u
SET is_company_seat = true
WHERE EXISTS (
  SELECT 1
  FROM public.company_invites ci
  WHERE LOWER(TRIM(ci.email)) = LOWER(TRIM(u.email))
    AND ci.company_id = u.company_id
    AND ci.status = 'accepted'
)
AND EXISTS (
  SELECT 1
  FROM public.subscriptions s
  WHERE s.user_id = u.id
    AND s.stripe_customer_id IS NULL
    AND s.stripe_subscription_id IS NULL
);

-- Mirrored paid seat: no Stripe on this row, active non-trial plan, and another company member has Stripe (the payer).
UPDATE public.users u
SET is_company_seat = true
FROM public.subscriptions s
WHERE u.id = s.user_id
  AND u.company_id IS NOT NULL
  AND s.stripe_customer_id IS NULL
  AND s.stripe_subscription_id IS NULL
  AND s.plan IS NOT NULL
  AND s.plan <> 'free_trial'
  AND s.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM public.users u2
    INNER JOIN public.subscriptions s2 ON s2.user_id = u2.id
    WHERE u2.company_id = u.company_id
      AND u2.id <> u.id
      AND (s2.stripe_customer_id IS NOT NULL OR s2.stripe_subscription_id IS NOT NULL)
  );
