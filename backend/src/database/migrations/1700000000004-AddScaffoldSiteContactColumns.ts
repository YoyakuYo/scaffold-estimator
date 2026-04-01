import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Aligns DB with supabase-migrations/019_scaffold_site_contact.sql (site / quotation header fields).
 */
export class AddScaffoldSiteContactColumns1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = 'scaffold_configurations';
    if (!(await queryRunner.hasTable(table))) return;

    if (!(await queryRunner.hasColumn(table, 'site_name'))) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'site_name', type: 'varchar', length: '255', isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn(table, 'site_address'))) {
      await queryRunner.addColumn(table, new TableColumn({ name: 'site_address', type: 'text', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(table, 'site_email'))) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'site_email', type: 'varchar', length: '255', isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn(table, 'site_phone'))) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'site_phone', type: 'varchar', length: '100', isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn(table, 'site_fax'))) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'site_fax', type: 'varchar', length: '100', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = 'scaffold_configurations';
    if (!(await queryRunner.hasTable(table))) return;

    for (const col of ['site_fax', 'site_phone', 'site_email', 'site_address', 'site_name']) {
      if (await queryRunner.hasColumn(table, col)) {
        await queryRunner.dropColumn(table, col);
      }
    }
  }
}
