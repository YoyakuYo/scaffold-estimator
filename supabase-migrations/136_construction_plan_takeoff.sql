-- Phase 3 — Construction Plan: extraction (per-floor × per-block element takeoff).
-- This migration creates the foundational schema for the structural-takeoff module:
--   * Projects own one or more upload "drawing sets" (batch uploads of zumen).
--   * Each set has files; each file is classified to (level, block, kind).
--   * Extracted elements are stored per (set, level, block, type) with quantities.

-- 1) Project owner table — light-weight wrapper for a single 案件 (job).
CREATE TABLE IF NOT EXISTS public.construction_plan_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  site_address text,
  notes text,
  /** Block (工区) names in erection order, e.g. ['A','B','C']. */
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Floor labels in erection order, e.g. ['1F','2F','3F','RF']. */
  levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS construction_plan_projects_company_idx
  ON public.construction_plan_projects (company_id, created_at DESC);

-- 2) DrawingSet — a batch upload (one wizard session). One project may have several.
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

-- 3) DrawingSetFile — one row per uploaded file in the batch.
CREATE TABLE IF NOT EXISTS public.drawing_set_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.drawing_sets(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  /**
   * Classification, populated either by deterministic filename heuristics or
   * by user override on the review screen. Source captures provenance so
   * re-running auto-classification never overwrites manual edits.
   */
  kind text,
  level text,
  block text,
  classification_source text NOT NULL DEFAULT 'auto',
  classification_confidence real,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drawing_set_files_set_idx
  ON public.drawing_set_files (set_id, created_at);

-- 4) Extracted elements — per (set, level, block, type) row with quantity table.
CREATE TABLE IF NOT EXISTS public.extracted_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.drawing_sets(id) ON DELETE CASCADE,
  level text NOT NULL,
  block text,
  /** One of: hashira (柱), oobari (大梁), kobari (小梁), taifubari (耐風梁),
      brace (ブレース), kaidan (階段), elevator (エレベーター), deck (デッキ). */
  element_type text NOT NULL,
  /** Mark / label, e.g. C1 / G1 / b1. */
  label text,
  /** Section spec, e.g. H-600x200x11x17. */
  section text,
  qty integer NOT NULL DEFAULT 0,
  /** Optional row-level grid hint (e.g. X1-Y1, X1-X8). */
  grid text,
  /** manual | excel | dxf | ai. */
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extracted_elements_set_idx
  ON public.extracted_elements (set_id, level, block, element_type);

-- RLS: service-role only (backend mediates all access).
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
