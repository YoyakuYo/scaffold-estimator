import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddUserApprovalStatus1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasApprovalStatus = await queryRunner.hasColumn('users', 'approval_status');
    if (!hasApprovalStatus) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'approval_status',
          type: 'enum',
          enum: ['pending', 'approved', 'rejected'],
          default: "'approved'",
          isNullable: false,
        }),
      );
    }

    const usersTable = await queryRunner.getTable('users');
    const hasApprovalStatusIndex = usersTable?.indices.some(
      (index) => index.name === 'IDX_users_approval_status',
    );

    if (!hasApprovalStatusIndex) {
      await queryRunner.createIndex(
        'users',
        new TableIndex({
          name: 'IDX_users_approval_status',
          columnNames: ['approval_status'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');
    const hasApprovalStatusIndex = usersTable?.indices.some(
      (index) => index.name === 'IDX_users_approval_status',
    );

    if (hasApprovalStatusIndex) {
      await queryRunner.dropIndex('users', 'IDX_users_approval_status');
    }

    const hasApprovalStatus = await queryRunner.hasColumn('users', 'approval_status');
    if (hasApprovalStatus) {
      await queryRunner.dropColumn('users', 'approval_status');
    }
  }
}
