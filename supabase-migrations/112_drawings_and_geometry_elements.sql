-- ============================================================
-- Migration 112: Recreate drawings and geometry_elements
-- ============================================================
-- Migration 100 drops these tables and their enum types.
-- QuotationService.get() loads relation config.drawing, so the
-- drawings table must exist. Run after 111.
-- ============================================================

-- 1. Recreate enum types (dropped by 100)
DO $$ BEGIN
  CREATE TYPE drawing_file_format AS ENUM (
    'pdf', 'dxf', 'dwg', 'jww', 'jpg', 'jpeg', 'png', 'gif',
    'bmp', 'webp', 'svg', 'tif', 'tiff'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE drawing_upload_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE geometry_element_type AS ENUM ('line', 'polyline', 'arc', 'circle', 'polygon', 'text', 'dimension');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. drawings (project_id varchar to match entity; no FK so it works without projects table)
CREATE TABLE IF NOT EXISTS drawings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                    VARCHAR(255) NOT NULL,
  filename                      VARCHAR(255) NOT NULL,
  file_format                   drawing_file_format NOT NULL,
  file_path                     VARCHAR(512) NOT NULL,
  file_size_bytes               BIGINT NOT NULL,
  uploaded_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by                   UUID NOT NULL,
  metadata                      JSONB,
  detected_structure_type       VARCHAR(50),
  user_confirmed_structure_type VARCHAR(50),
  normalized_geometry           JSONB,
  upload_status                 drawing_upload_status NOT NULL DEFAULT 'pending',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drawings_project_uploaded ON drawings(project_id, uploaded_at);

-- 3. geometry_elements (optional; used when drawing geometry is loaded)
CREATE TABLE IF NOT EXISTS geometry_elements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drawing_id        UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  element_type      geometry_element_type NOT NULL,
  coordinates       JSONB NOT NULL,
  layer_name        VARCHAR(255),
  properties        JSONB,
  extracted_length  DECIMAL(10, 2),
  extracted_area    DECIMAL(15, 2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geometry_elements_drawing ON geometry_elements(drawing_id);
CREATE INDEX IF NOT EXISTS idx_geometry_elements_drawing_layer ON geometry_elements(drawing_id, layer_name);

-- 4. RLS
ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE geometry_elements ENABLE ROW LEVEL SECURITY;
