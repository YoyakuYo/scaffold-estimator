-- Tenant-aware platform stats for superadmin dashboards (avoids counting empty company rows).
-- Also removes companies with no user rows (orphan placeholders).

-- 1) One-time cleanup: delete companies that no user references
DELETE FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.company_id = c.id);

-- 2) RPC used by Nest getPlatformStats (service role)
CREATE OR REPLACE FUNCTION public.admin_platform_tenant_stats()
RETURNS TABLE (tenant_users bigint, tenant_companies bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.users u WHERE u.role IS DISTINCT FROM 'superadmin'),
    (
      SELECT COUNT(DISTINCT u.company_id)::bigint
      FROM public.users u
      WHERE u.role IS DISTINCT FROM 'superadmin'
        AND u.company_id IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.admin_platform_tenant_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_platform_tenant_stats() TO service_role;

COMMENT ON FUNCTION public.admin_platform_tenant_stats IS
  'Counts non-superadmin users and distinct companies that have at least one such user; used by API platform stats.';
