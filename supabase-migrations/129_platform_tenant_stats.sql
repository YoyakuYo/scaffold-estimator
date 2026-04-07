DELETE FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.company_id = c.id);

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
