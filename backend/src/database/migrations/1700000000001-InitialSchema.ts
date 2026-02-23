import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class InitialSchema1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create companies table
    await queryRunner.createTable(
      new Table({
        name: 'companies',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'tax_id',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'address',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'phone',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create users table
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'company_id',
            type: 'uuid',
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'password_hash',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['superadmin', 'estimator', 'viewer'],
            default: "'viewer'",
          },
          {
            name: 'first_name',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'last_name',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_email',
        columnNames: ['email'],
      }),
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_company_id',
        columnNames: ['company_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'users',
      new TableForeignKey({
        columnNames: ['company_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'companies',
        onDelete: 'CASCADE',
      }),
    );

    // Create drawings table
    await queryRunner.createTable(
      new Table({
        name: 'drawings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'project_id',
            type: 'uuid',
          },
          {
            name: 'filename',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'file_format',
            type: 'enum',
            enum: ['pdf', 'dxf', 'dwg'],
          },
          {
            name: 'file_path',
            type: 'varchar',
            length: '512',
          },
          {
            name: 'file_size_bytes',
            type: 'bigint',
          },
          {
            name: 'uploaded_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'uploaded_by',
            type: 'uuid',
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'detected_structure_type',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'user_confirmed_structure_type',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'normalized_geometry',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'upload_status',
            type: 'enum',
            enum: ['pending', 'processing', 'completed', 'failed'],
            default: "'pending'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'drawings',
      new TableIndex({
        name: 'IDX_drawings_project_uploaded',
        columnNames: ['project_id', 'uploaded_at'],
      }),
    );

    // Create geometry_elements table
    await queryRunner.createTable(
      new Table({
        name: 'geometry_elements',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'drawing_id',
            type: 'uuid',
          },
          {
            name: 'element_type',
            type: 'enum',
            enum: ['line', 'polyline', 'arc', 'circle', 'polygon', 'text', 'dimension'],
          },
          {
            name: 'coordinates',
            type: 'jsonb',
          },
          {
            name: 'layer_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'properties',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'extracted_length',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'extracted_area',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'geometry_elements',
      new TableIndex({
        name: 'IDX_geometry_drawing_layer',
        columnNames: ['drawing_id', 'layer_name'],
      }),
    );

    await queryRunner.createForeignKey(
      'geometry_elements',
      new TableForeignKey({
        columnNames: ['drawing_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'drawings',
        onDelete: 'CASCADE',
      }),
    );

    // Create estimates table
    await queryRunner.createTable(
      new Table({
        name: 'estimates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'project_id',
            type: 'uuid',
          },
          {
            name: 'drawing_id',
            type: 'uuid',
          },
          {
            name: 'structure_type',
            type: 'enum',
            enum: ['改修工事', 'S造', 'RC造'],
          },
          {
            name: 'rental_start_date',
            type: 'date',
          },
          {
            name: 'rental_end_date',
            type: 'date',
          },
          {
            name: 'rental_type',
            type: 'enum',
            enum: ['weekly', 'monthly', 'custom'],
          },
          {
            name: 'bill_of_materials',
            type: 'jsonb',
          },
          {
            name: 'total_estimated_cost',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['draft', 'pending_review', 'approved', 'rejected', 'finalized'],
            default: "'draft'",
          },
          {
            name: 'created_by',
            type: 'uuid',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'finalized_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'estimates',
      new TableIndex({
        name: 'IDX_estimates_project_id',
        columnNames: ['project_id'],
      }),
    );

    await queryRunner.createIndex(
      'estimates',
      new TableIndex({
        name: 'IDX_estimates_drawing_id',
        columnNames: ['drawing_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'estimates',
      new TableForeignKey({
        columnNames: ['drawing_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'drawings',
        onDelete: 'SET NULL',
      }),
    );

    // Create cost_line_items table
    await queryRunner.createTable(
      new Table({
        name: 'cost_line_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'estimate_id',
            type: 'uuid',
          },
          {
            name: 'code',
            type: 'varchar',
            length: '20',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'category',
            type: 'enum',
            enum: ['basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other'],
          },
          {
            name: 'formula_expression',
            type: 'text',
          },
          {
            name: 'formula_variables',
            type: 'jsonb',
          },
          {
            name: 'computed_value',
            type: 'decimal',
            precision: 15,
            scale: 2,
            default: 0,
          },
          {
            name: 'user_edited_value',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'is_locked',
            type: 'boolean',
            default: false,
          },
          {
            name: 'edited_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'edited_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'edit_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'cost_line_items',
      new TableIndex({
        name: 'IDX_cost_items_estimate_category',
        columnNames: ['estimate_id', 'category'],
      }),
    );

    await queryRunner.createForeignKey(
      'cost_line_items',
      new TableForeignKey({
        columnNames: ['estimate_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'estimates',
        onDelete: 'CASCADE',
      }),
    );

    // Create cost_master_data table
    await queryRunner.createTable(
      new Table({
        name: 'cost_master_data',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'category',
            type: 'enum',
            enum: ['basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other'],
          },
          {
            name: 'region',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'fiscal_year',
            type: 'int',
          },
          {
            name: 'material_basic_rate',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'damage_rate',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'transport_rate',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'cleaning_rate',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'repair_rate',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'wear_rate_percent',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'disposal_rate_percent',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'surface_prep_rate_percent',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'audit_log',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_by',
            type: 'uuid',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'cost_master_data',
      new TableIndex({
        name: 'IDX_cost_master_category_region_year',
        columnNames: ['category', 'region', 'fiscal_year'],
        isUnique: true,
      }),
    );

    // Create estimate_exports table
    await queryRunner.createTable(
      new Table({
        name: 'estimate_exports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'estimate_id',
            type: 'uuid',
          },
          {
            name: 'export_format',
            type: 'enum',
            enum: ['pdf', 'excel'],
          },
          {
            name: 'file_path',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'file_size_bytes',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'generated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'generated_by',
            type: 'uuid',
          },
          {
            name: 's3_url',
            type: 'varchar',
            length: '1024',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'estimate_exports',
      new TableIndex({
        name: 'IDX_exports_estimate_id',
        columnNames: ['estimate_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'estimate_exports',
      new TableForeignKey({
        columnNames: ['estimate_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'estimates',
        onDelete: 'CASCADE',
      }),
    );

    // Create audit_log table
    await queryRunner.createTable(
      new Table({
        name: 'audit_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'entity_type',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'entity_id',
            type: 'uuid',
          },
          {
            name: 'action',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'old_values',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'new_values',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'timestamp',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'ip_address',
            type: 'inet',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'audit_log',
      new TableIndex({
        name: 'IDX_audit_entity',
        columnNames: ['entity_type', 'entity_id'],
      }),
    );

    await queryRunner.createIndex(
      'audit_log',
      new TableIndex({
        name: 'IDX_audit_timestamp',
        columnNames: ['timestamp'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.dropTable('audit_log', true);
    await queryRunner.dropTable('estimate_exports', true);
    await queryRunner.dropTable('cost_master_data', true);
    await queryRunner.dropTable('cost_line_items', true);
    await queryRunner.dropTable('estimates', true);
    await queryRunner.dropTable('geometry_elements', true);
    await queryRunner.dropTable('drawings', true);
    await queryRunner.dropTable('users', true);
    await queryRunner.dropTable('companies', true);
  }
}
