-- Phase 3 (gap #1): persist Construction Plan uploads to Supabase Storage so
-- they can be downloaded, re-classified later (e.g. by an AI vision pass), or
-- previewed by the user. The backend uses the service role key, which bypasses
-- RLS — but we still set authenticated-only policies as defense in depth.

-- 1) Create the bucket if it does not exist. Private (no public listing/read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('construction-plan-files', 'construction-plan-files', false)
ON CONFLICT (id) DO NOTHING;

-- 2) RLS policies on storage.objects scoped to this bucket.
-- The backend always uses the service role, so it bypasses these. These policies
-- only matter if someone ever proxies a user JWT directly to Supabase Storage.

DROP POLICY IF EXISTS construction_plan_files_service_role_all ON storage.objects;
CREATE POLICY construction_plan_files_service_role_all
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'construction-plan-files' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'construction-plan-files' AND auth.role() = 'service_role');

-- Authenticated users can list / read objects in this bucket. They never
-- write directly — the backend mediates uploads via the service role.
DROP POLICY IF EXISTS construction_plan_files_authenticated_read ON storage.objects;
CREATE POLICY construction_plan_files_authenticated_read
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'construction-plan-files' AND auth.role() = 'authenticated');
