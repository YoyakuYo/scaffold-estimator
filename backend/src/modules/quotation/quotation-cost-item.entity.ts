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
import { Quotation } from './quotation.entity';

export type CostCategory = 'basic_charge' | 'damage_charge' | 'transport' | 'loss' | 'cleaning' | 'repair';

@Entity('quotation_cost_items')
@Index(['quotationId', 'category'])
export class QuotationCostItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quotation_id' })
  quotationId: string;

  @ManyToOne(() => Quotation, (quotation) => quotation.costItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quotation_id' })
  quotation: Quotation;

  @Column()
  code: string; // 'basic_material', 'material_wear', 'transportation', 'disposal', 'surface_prep', 'repair_reserve'

  @Column()
  name: string; // '仮設材基本料', '仮設材損料', '運搬費', '滅失費', 'ケレン費', '修理代金'

  @Column({ type: 'enum', enum: ['basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair'] })
  category: CostCategory;

  @Column({ type: 'text', name: 'formula_expression', nullable: true })
  formulaExpression: string; // e.g., "totalArea * materialBasicRate * rentalMonths"

  @Column({ type: 'jsonb', name: 'formula_variables', nullable: true })
  formulaVariables: Record<string, any>;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'calculated_value', default: 0 })
  calculatedValue: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'user_edited_value', nullable: true })
  userEditedValue: number;

  @Column({ name: 'is_locked', default: false })
  isLocked: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
