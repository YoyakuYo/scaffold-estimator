-- ============================================================
-- Migration 001: Enable Required Extensions
-- Run this FIRST in Supabase SQL Editor
-- ============================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crypto functions (used by Supabase Auth internally)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
