import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBankWireIntent1700000000012 implements MigrationInterface {
  name = 'AddBankWireIntent1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bank_wire_reference" text
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bank_wire_intent_plan" text
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_bank_wire_intent_plan_check"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_bank_wire_intent_plan_check"
      CHECK ("bank_wire_intent_plan" IS NULL OR "bank_wire_intent_plan" IN ('basic', 'medium', 'premium'))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_bank_wire_reference_unique"
      ON "users" ("bank_wire_reference")
      WHERE "bank_wire_reference" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "users_bank_wire_reference_unique"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_bank_wire_intent_plan_check"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "bank_wire_intent_plan"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "bank_wire_reference"`);
  }
}
