import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Estimate } from '../estimate/estimate.entity';

export type CostCategory = 'basic_charge' | 'damage_charge' | 'transport' | 'loss' | 'cleaning' | 'repair' | 'other';

@Entity('cost_line_items')
@Index(['estimateId', 'category'])
export class CostLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'estimate_id' })
  estimateId: string;

  @ManyToOne(() => Estimate, (estimate) => estimate.costBreakdown, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'estimate_id' })
  estimate: Estimate;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ['basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other'] })
  category: CostCategory;

  @Column({ type: 'text', name: 'formula_expression' })
  formulaExpression: string; // e.g., "totalArea * materialRate * rentalWeeks"

  @Column({ type: 'jsonb', name: 'formula_variables' })
  formulaVariables: {
    [key: string]: {
      name: string;
      source: 'geometry' | 'rental_config' | 'master_data' | 'user_input';
      masterId?: string;
      value?: any;
    };
  };

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'computed_value', default: 0 })
  computedValue: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'user_edited_value', nullable: true })
  userEditedValue: number;

  @Column({ name: 'is_locked', default: false })
  isLocked: boolean;

  @Column({ name: 'edited_by', nullable: true })
  editedBy: string;

  @Column({ name: 'edited_at', nullable: true })
  editedAt: Date;

  @Column({ name: 'edit_reason', type: 'text', nullable: true })
  editReason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
