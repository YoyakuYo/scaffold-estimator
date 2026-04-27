-- Phase 4 — gap #7: persistence layer for foreman overrides on the
-- generated delivery plan. One row per drawing set. The override JSON
-- describes per-day, per-bin transformations that get applied on top of
-- the freshly-generated plan when the API responds.

CREATE TABLE IF NOT EXISTS public.delivery_plan_overrides (
  set_id uuid PRIMARY KEY REFERENCES public.drawing_sets(id) ON DELETE CASCADE,
  /**
   * Shape:
   *   { trucks: [
   *       { date: '2026-05-06', binNo: 1, truckType?: '4t'|'10t'|'25t_trailer'|'4tunic',
   *         note?: string }
   *   ] }
   */
  edits jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_plan_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_plan_overrides_service_role ON public.delivery_plan_overrides;
CREATE POLICY delivery_plan_overrides_service_role
  ON public.delivery_plan_overrides FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
