import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Construction Plan job — per-customer 案件 wrapper. Owns one or more
 * `DrawingSet` rows (uploads) and the working set of blocks/levels.
 */
@Entity('construction_plan_projects')
@Index(['companyId', 'createdAt'])
export class ConstructionPlanProject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'site_address', type: 'text', nullable: true })
  siteAddress: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Block (工区) labels in erection order, e.g. ['A','B','C']. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  blocks: string[];

  /** Floor labels in erection order, e.g. ['1F','2F','3F','RF']. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  levels: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
