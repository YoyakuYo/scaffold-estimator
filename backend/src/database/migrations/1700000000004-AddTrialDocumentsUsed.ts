import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrialDocumentsUsed1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS trial_documents_used integer NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscriptions DROP COLUMN IF EXISTS trial_documents_used;
    `);
  }
}
