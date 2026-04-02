-- Trial file upload counter (max 2 during trialing; enforced in API)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_documents_used integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN subscriptions.trial_documents_used IS 'Drawing file uploads counted during status=trialing (app limit 2).';
