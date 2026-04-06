import { MigrationInterface, QueryRunner } from 'typeorm';

/** Mirrors supabase-migrations/121_team_invites.sql — team invites + optional users.branch_id */
export class AddCompanyInvites1700000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.company_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES public.company_branches(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        invited_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'estimator')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_company_invites_company_status ON public.company_invites (company_id, status);
      CREATE INDEX IF NOT EXISTS idx_company_invites_pending_expires ON public.company_invites (company_id) WHERE status = 'pending';
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS company_invites_one_pending_per_email
        ON public.company_invites (company_id, (LOWER(TRIM(email))))
        WHERE status = 'pending';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_company_invites_token_pending ON public.company_invites (token_hash) WHERE status = 'pending';
    `);

    await queryRunner.query(`
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.company_branches(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.company_invites;`);
  }
}
