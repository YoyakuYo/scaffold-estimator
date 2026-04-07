import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMonthlyBankPlanTierCheck1700000000013 implements MigrationInterface {
  name = 'AddMonthlyBankPlanTierCheck1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_pending_bank_plan_check"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_pending_bank_plan_check"
      CHECK ("pending_bank_plan" IS NULL OR "pending_bank_plan" IN ('basic', 'medium', 'premium', 'monthly'))
    `);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_bank_wire_intent_plan_check"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_bank_wire_intent_plan_check"
      CHECK ("bank_wire_intent_plan" IS NULL OR "bank_wire_intent_plan" IN ('basic', 'medium', 'premium', 'monthly'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_bank_wire_intent_plan_check"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_bank_wire_intent_plan_check"
      CHECK ("bank_wire_intent_plan" IS NULL OR "bank_wire_intent_plan" IN ('basic', 'medium', 'premium'))
    `);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_pending_bank_plan_check"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_pending_bank_plan_check"
      CHECK ("pending_bank_plan" IS NULL OR "pending_bank_plan" IN ('basic', 'medium', 'premium'))
    `);
  }
}
