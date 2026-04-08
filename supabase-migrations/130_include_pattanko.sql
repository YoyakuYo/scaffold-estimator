-- User toggle: include パッタンコ (corner filler) in BOM / 3D when Yes.
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS include_pattanko boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN scaffold_configurations.include_pattanko IS 'When false, PATTANKO is omitted from quantities and corner filler meshes in 3D.';
