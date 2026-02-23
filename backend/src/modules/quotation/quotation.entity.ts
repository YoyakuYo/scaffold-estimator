import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ScaffoldConfiguration } from '../scaffold-config/scaffold-config.entity';
import { QuotationItem } from './quotation-item.entity';
import { QuotationCostItem } from './quotation-cost-item.entity';

export type QuotationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'finalized';

@Entity('quotations')
@Index(['projectId'])
@Index(['configId'])
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'varchar', length: 255 })
  projectId: string;

  @Column({ name: 'config_id' })
  configId: string;

  @ManyToOne(() => ScaffoldConfiguration)
  @JoinColumn({ name: 'config_id' })
  config: ScaffoldConfiguration;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string;

  @Column({ type: 'date', name: 'rental_start_date' })
  rentalStartDate: Date;

  @Column({ type: 'date', name: 'rental_end_date' })
  rentalEndDate: Date;

  @Column({ type: 'varchar', length: 20, name: 'rental_type' })
  rentalType: string;

  @OneToMany(() => QuotationItem, (item) => item.quotation, { cascade: true })
  items: QuotationItem[];

  @OneToMany(() => QuotationCostItem, (cost) => cost.quotation, { cascade: true })
  costItems: QuotationCostItem[];

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'material_subtotal', default: 0 })
  materialSubtotal: number; // Material costs (quantity × price)

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'cost_subtotal', default: 0 })
  costSubtotal: number; // Rental period-based costs (6 categories)

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'subtotal', default: 0 })
  subtotal: number; // materialSubtotal + costSubtotal

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'tax_amount', default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'total_amount', default: 0 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 30, default: 'draft' })
  status: QuotationStatus;

  @Column({ name: 'created_by' })
  createdBy: string;

  @Column({ name: 'finalized_at', nullable: true })
  finalizedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
