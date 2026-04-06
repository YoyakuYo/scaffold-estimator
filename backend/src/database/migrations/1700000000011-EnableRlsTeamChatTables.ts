import { MigrationInterface, QueryRunner } from 'typeorm';

/** Mirrors supabase-migrations/126_enable_rls_team_chat_tables.sql */
export class EnableRlsTeamChatTables1700000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(`
      ALTER TABLE public.team_dm_messages ENABLE ROW LEVEL SECURITY;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.team_chat_messages DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(`
      ALTER TABLE public.team_dm_messages DISABLE ROW LEVEL SECURITY;
    `);
  }
}
