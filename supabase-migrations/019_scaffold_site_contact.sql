-- Optional site / contact fields for scaffold configurations (quotation header)
ALTER TABLE scaffold_configurations
  ADD COLUMN IF NOT EXISTS site_name varchar(255),
  ADD COLUMN IF NOT EXISTS site_address text,
  ADD COLUMN IF NOT EXISTS site_email varchar(255),
  ADD COLUMN IF NOT EXISTS site_phone varchar(100),
  ADD COLUMN IF NOT EXISTS site_fax varchar(100);
