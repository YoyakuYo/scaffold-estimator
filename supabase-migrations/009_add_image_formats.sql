-- ============================================================
-- Migration 009: Add Image Formats Support
-- Run this in Supabase SQL Editor
-- ============================================================

-- Option 1: Add image formats to the existing enum (run this first)
-- If this fails, use Option 2 below

ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'jpg';
ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'jpeg';
ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'png';
ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'gif';
ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'bmp';
ALTER TYPE drawing_file_format ADD VALUE IF NOT EXISTS 'webp';

-- Option 2: If the enum doesn't exist or Option 1 failed, convert column to varchar
-- Uncomment and run these lines if Option 1 didn't work:

-- ALTER TABLE drawings ALTER COLUMN file_format TYPE varchar(10);
