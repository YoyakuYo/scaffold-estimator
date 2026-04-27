-- Standalone PostgREST schema-cache reload.
--
-- Run this on its own whenever you see the "Could not find the table 'public.X'
-- in the schema cache" error from the API after applying a fresh migration.
-- Safe to re-run any time.
--
-- Symptom: tables exist (verified via information_schema.tables), but
-- /api/v1/structural-takeoff/projects (or any other newly-added route)
-- returns 400 with a "schema cache" message.
-- Cause: Supabase's PostgREST process didn't observe the schema change.
-- Fix: this NOTIFY tells PostgREST to refresh its in-memory schema map.

NOTIFY pgrst, 'reload schema';
