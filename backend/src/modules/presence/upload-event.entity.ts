import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type UploadProductCode = 'scaffold' | 'bim' | 'construction_plan';

/**
 * Audit-trail style upload feed. Insert-only.
 * Backend writes one row per upload across products so the superadmin
 * cockpit can show a unified "recent uploads" stream.
 */
@Entity('upload_events')
@Index(['createdAt'])
@Index(['userId', 'createdAt'])
@Index(['companyId', 'createdAt'])
@Index(['productCode', 'createdAt'])
export class UploadEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'product_code', type: 'text', default: 'scaffold' })
  productCode: UploadProductCode;

  /**
   * Free-form upload kind, e.g. `'drawing'`, `'scaffold_config'`, `'ifc'`,
   * `'dxf'`, `'pdf'`, `'image'`, `'premium_schedule'`, `'vision_analyze'`.
   */
  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'text', nullable: true })
  filename: string | null;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | number | null;

  /** Optional ID linking back to the entity created (drawing.id, scaffold_configurations.id, etc.). */
  @Column({ name: 'ref_id', type: 'text', nullable: true })
  refId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
