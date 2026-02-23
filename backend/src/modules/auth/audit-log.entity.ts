import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_log')
@Index(['entityType', 'entityId'])
@Index(['timestamp'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type' })
  entityType: string; // 'estimate', 'cost_item', 'cost_master', etc.

  @Column({ name: 'entity_id' })
  entityId: string;

  @Column()
  action: string; // 'create', 'update', 'delete', 'export'

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'jsonb', name: 'old_values', nullable: true })
  oldValues: Record<string, any>;

  @Column({ type: 'jsonb', name: 'new_values', nullable: true })
  newValues: Record<string, any>;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string;
}
