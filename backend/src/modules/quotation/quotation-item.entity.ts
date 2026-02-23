import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Quotation } from './quotation.entity';

@Entity('quotation_items')
@Index(['quotationId'])
export class QuotationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quotation_id' })
  quotationId: string;

  @ManyToOne(() => Quotation, (q) => q.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quotation_id' })
  quotation: Quotation;

  @Column({ type: 'varchar', length: 50, name: 'component_type' })
  componentType: string;

  @Column({ type: 'varchar', length: 100, name: 'component_name' })
  componentName: string;

  @Column({ type: 'varchar', length: 50, name: 'size_spec' })
  sizeSpec: string;

  @Column({ type: 'varchar', length: 20 })
  unit: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'line_total' })
  lineTotal: number;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
