-- Align DB default with app default (building wall → nearest posts, mm).
ALTER TABLE scaffold_configurations ALTER COLUMN wall_standoff_mm SET DEFAULT 300;
