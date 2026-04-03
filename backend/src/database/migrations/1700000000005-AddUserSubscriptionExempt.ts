import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserSubscriptionExempt1700000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasCol = await queryRunner.hasColumn('users', 'subscription_exempt');
    if (!hasCol) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'subscription_exempt',
          type: 'boolean',
          default: false,
          isNullable: false,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasCol = await queryRunner.hasColumn('users', 'subscription_exempt');
    if (hasCol) {
      await queryRunner.dropColumn('users', 'subscription_exempt');
    }
  }
}
