import { MigrationInterface, QueryRunner } from 'typeorm';

/** Mirrors supabase-migrations/122_user_is_company_seat.sql */
export class AddUserIsCompanySeat1700000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS is_company_seat BOOLEAN NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_company_seat ON public.users (company_id) WHERE is_company_seat = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_company_seat;`);
    await queryRunner.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS is_company_seat;`);
  }
}
