import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetTokens1700000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION get_user_id_by_email_ci(p_email text)
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT id FROM users WHERE lower(trim(email)) = lower(trim(p_email)) LIMIT 1;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS get_user_id_by_email_ci(text);`);
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_tokens;`);
  }
}
