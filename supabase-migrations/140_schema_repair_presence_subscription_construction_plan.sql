-- Hotfix: repair schema drift in environments missing late migrations.
-- Covers:
--   - subscriptions.product_code (phase 2)
--   - user_presence (phase 2)
--   - construction plan takeoff tables (phase 3)
--   - delivery_plan_overrides + storage bucket (phase 4)

-- -------------------------------------------------------------------
-- 1) subscriptions.product_code backfill + compatibility indexes
-- -------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product_code text NOT NULL DEFAULT 'scaffold';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS company_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_company_id_fkey'
  ) THEN
    RETURN;
  END IF;
  IF to_regclass('public.companies') IS NOT NULL THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  ELSIF to_regclass('public.organizations') IS NOT NULL THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.subscriptions
SET product_code = 'scaffold'
WHERE product_code IS NULL OR product_code = '';

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
END $$;

DROP INDEX IF EXISTS subscriptions_user_id_key;
DROP INDEX IF EXISTS public.subscriptions_user_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_product_idx
  ON public.subscriptions (user_id, product_code);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'company_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS subscriptions_company_product_idx
      ON public.subscriptions (company_id, product_code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS subscriptions_product_idx
  ON public.subscriptions (product_code);

-- -------------------------------------------------------------------
-- 2) user_presence table (admin live presence)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  page_key text,
  label text,
  last_action text,
  last_action_at timestamptz,
  ip_address inet,
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_presence_updated_at_idx
  ON public.user_presence (updated_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_presence_service_role_all ON public.user_presence;
CREATE POLICY user_presence_service_role_all
  ON public.user_presence
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -------------------------------------------------------------------
-- 3) construction plan takeoff core tables
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.construction_plan_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  site_address text,
  notes text,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'construction_plan_projects_company_id_fkey'
  ) THEN
    RETURN;
  END IF;
  IF to_regclass('public.companies') IS NOT NULL THEN
    ALTER TABLE public.construction_plan_projects
      ADD CONSTRAINT construction_plan_projects_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  ELSIF to_regclass('public.organizations') IS NOT NULL THEN
    ALTER TABLE public.construction_plan_projects
      ADD CONSTRAINT construction_plan_projects_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS construction_plan_projects_company_idx
  ON public.construction_plan_projects (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.drawing_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.construction_plan_projects(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text,
  notes text,
  status text NOT NULL DEFAULT 'classifying',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drawing_sets_project_idx
  ON public.drawing_sets (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.drawing_set_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.drawing_sets(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  kind text,
  level text,
  block text,
  classification_source text NOT NULL DEFAULT 'auto',
  classification_confidence real,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drawing_set_files_set_idx
  ON public.drawing_set_files (set_id, created_at);

CREATE TABLE IF NOT EXISTS public.extracted_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.drawing_sets(id) ON DELETE CASCADE,
  level text NOT NULL,
  block text,
  element_type text NOT NULL,
  label text,
  section text,
  qty integer NOT NULL DEFAULT 0,
  grid text,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extracted_elements_set_idx
  ON public.extracted_elements (set_id, level, block, element_type);

ALTER TABLE public.construction_plan_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_set_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_elements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS construction_plan_projects_service_role ON public.construction_plan_projects;
CREATE POLICY construction_plan_projects_service_role
  ON public.construction_plan_projects FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS drawing_sets_service_role ON public.drawing_sets;
CREATE POLICY drawing_sets_service_role
  ON public.drawing_sets FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS drawing_set_files_service_role ON public.drawing_set_files;
CREATE POLICY drawing_set_files_service_role
  ON public.drawing_set_files FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS extracted_elements_service_role ON public.extracted_elements;
CREATE POLICY extracted_elements_service_role
  ON public.extracted_elements FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- -------------------------------------------------------------------
-- 4) delivery plan overrides + storage bucket
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_plan_overrides (
  set_id uuid PRIMARY KEY,
  edits jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_plan_overrides_set_id_fkey'
  ) THEN
    RETURN;
  END IF;
  IF to_regclass('public.drawing_sets') IS NOT NULL THEN
    ALTER TABLE public.delivery_plan_overrides
      ADD CONSTRAINT delivery_plan_overrides_set_id_fkey
      FOREIGN KEY (set_id) REFERENCES public.drawing_sets (id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.delivery_plan_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_plan_overrides_service_role ON public.delivery_plan_overrides;
CREATE POLICY delivery_plan_overrides_service_role
  ON public.delivery_plan_overrides FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Hosted Supabase installs BEFORE DELETE triggers on storage.* that reject
-- direct deletes unless a maintenance GUC is set (DROP POLICY can hit this).
BEGIN;
SELECT set_config('storage.allow_delete_query', 'true', true);
SELECT set_config('storage.can_delete', 'true', true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('construction-plan-files', 'construction-plan-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS construction_plan_files_service_role_all ON storage.objects;
CREATE POLICY construction_plan_files_service_role_all
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'construction-plan-files' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'construction-plan-files' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS construction_plan_files_authenticated_read ON storage.objects;
CREATE POLICY construction_plan_files_authenticated_read
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'construction-plan-files' AND auth.role() = 'authenticated');

COMMIT;

-- -------------------------------------------------------------------
-- 5) Force PostgREST to reload its schema cache.
-- Supabase normally listens for schema changes automatically, but DO blocks
-- and CREATE-IF-NOT-EXISTS sequences sometimes slip past its trigger and
-- the API keeps returning "Could not find the table … in the schema cache"
-- until reload. Re-issuing this NOTIFY at the end of every schema-changing
-- migration is the canonical fix.
-- -------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
