-- ============================================================
-- Migration 002: Create All ENUM Types
-- Run this SECOND in Supabase SQL Editor
-- ============================================================

-- User roles
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'estimator', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drawing file formats
DO $$ BEGIN
  CREATE TYPE drawing_file_format AS ENUM ('pdf', 'dxf', 'dwg');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drawing upload status
DO $$ BEGIN
  CREATE TYPE drawing_upload_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Structure type (Japanese construction types)
DO $$ BEGIN
  CREATE TYPE structure_type AS ENUM ('改修工事', 'S造', 'RC造');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rental period type
DO $$ BEGIN
  CREATE TYPE rental_period_type AS ENUM ('weekly', 'monthly', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Estimate status
DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'finalized');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cost category
DO $$ BEGIN
  CREATE TYPE cost_category AS ENUM ('basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Geometry element type
DO $$ BEGIN
  CREATE TYPE geometry_element_type AS ENUM ('line', 'polyline', 'arc', 'circle', 'polygon', 'text', 'dimension');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Export format
DO $$ BEGIN
  CREATE TYPE export_format AS ENUM ('pdf', 'excel');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
