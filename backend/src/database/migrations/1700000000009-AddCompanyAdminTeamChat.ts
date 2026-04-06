import { MigrationInterface, QueryRunner } from 'typeorm';

/** Mirrors supabase-migrations/124_company_admin_team_chat.sql */
export class AddCompanyAdminTeamChat1700000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS is_company_admin BOOLEAN NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_company_admin
        ON public.users (company_id)
        WHERE is_company_admin = true;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.team_chat_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        sender_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
        body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 5000),
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_chat_messages_company_created
        ON public.team_chat_messages (company_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_team_chat_messages_company_created;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.team_chat_messages;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_one_company_admin;`);
    await queryRunner.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS is_company_admin;`);
  }
}
