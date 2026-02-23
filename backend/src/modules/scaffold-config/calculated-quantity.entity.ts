import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ScaffoldConfiguration } from './scaffold-config.entity';

@Entity('calculated_quantities')
@Index(['configId'])
export class CalculatedQuantity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'config_id' })
  configId: string;

  @ManyToOne(() => ScaffoldConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'config_id' })
  config: ScaffoldConfiguration;

  @Column({ type: 'varchar', length: 50, name: 'component_type' })
  componentType: string;

  @Column({ type: 'varchar', length: 100, name: 'component_name' })
  componentName: string;

  @Column({ type: 'varchar', length: 50, name: 'size_spec' })
  sizeSpec: string;

  @Column({ type: 'varchar', length: 20 })
  unit: string;

  @Column({ type: 'int', name: 'calculated_quantity' })
  calculatedQuantity: number;

  @Column({ type: 'int', name: 'adjusted_quantity', nullable: true })
  adjustedQuantity: number | null;

  @Column({ type: 'text', name: 'adjustment_reason', nullable: true })
  adjustmentReason: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'unit_price', default: 0 })
  unitPrice: number;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
