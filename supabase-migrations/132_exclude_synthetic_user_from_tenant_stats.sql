-- Exclude synthetic landing-contact inbox user from platform tenant counts (see 131 + backend system-users constant).

CREATE OR REPLACE FUNCTION public.admin_platform_tenant_stats()
RETURNS TABLE (tenant_users bigint, tenant_companies bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint
     FROM public.users u
     WHERE u.role IS DISTINCT FROM 'superadmin'
       AND lower(u.email) <> lower('__landing_contact__@system.local')),
    (
      SELECT COUNT(DISTINCT u.company_id)::bigint
      FROM public.users u
      WHERE u.role IS DISTINCT FROM 'superadmin'
        AND u.company_id IS NOT NULL
        AND lower(u.email) <> lower('__landing_contact__@system.local')
    );
$$;

REVOKE ALL ON FUNCTION public.admin_platform_tenant_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_platform_tenant_stats() TO service_role;
