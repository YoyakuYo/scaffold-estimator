import { MigrationInterface, QueryRunner } from 'typeorm';

/** Mirrors supabase-migrations/129_platform_tenant_stats.sql */
export class AdminPlatformTenantStats1700000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM public.companies c
      WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.company_id = c.id);
    `);
    await queryRunner.query(`
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
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION public.admin_platform_tenant_stats() FROM PUBLIC;`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION public.admin_platform_tenant_stats() TO postgres;`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          GRANT EXECUTE ON FUNCTION public.admin_platform_tenant_stats() TO service_role;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.admin_platform_tenant_stats();`);
  }
}
