import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { Drawing, StructureType } from '../drawing/drawing.entity';
import { CostLineItem } from '../cost/cost-line-item.entity';
import { EstimateExport } from '../export/estimate-export.entity';

export type RentalPeriodType = 'weekly' | 'monthly' | 'custom';
export type EstimateStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'finalized';

@Entity('estimates')
@Index(['projectId'])
@Index(['drawingId'])
export class Estimate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'varchar', length: 255 })
  projectId: string;

  @Column({ name: 'drawing_id' })
  drawingId: string;

  @ManyToOne(() => Drawing)
  @JoinColumn({ name: 'drawing_id' })
  drawing: Drawing;

  @Column({ type: 'enum', enum: ['改修工事', 'S造', 'RC造'], name: 'structure_type' })
  structureType: StructureType;

  @Column({ type: 'date', name: 'rental_start_date' })
  rentalStartDate: Date;

  @Column({ type: 'date', name: 'rental_end_date' })
  rentalEndDate: Date;

  @Column({ type: 'enum', enum: ['weekly', 'monthly', 'custom'], name: 'rental_type' })
  rentalType: RentalPeriodType;

  @Column({ type: 'jsonb', name: 'bill_of_materials' })
  billOfMaterials: {
    scaffoldingType: string;
    components: Array<{
      componentId: string;
      componentName: string;
      quantity: number;
      unit: string;
      unitPrice: number;
      manualOverride: boolean;
      overrideReason?: string;
    }>;
    totalArea: number;
    totalHeight: number;
    estimatedWeight?: number;
    adjustmentCoefficient: number;
    confidence: number;
  };

  @OneToMany(() => CostLineItem, (item) => item.estimate, { cascade: true })
  costBreakdown: CostLineItem[];

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'total_estimated_cost', nullable: true })
  totalEstimatedCost: number;

  @Column({ type: 'enum', enum: ['draft', 'pending_review', 'approved', 'rejected', 'finalized'], default: 'draft' })
  status: EstimateStatus;

  @Column({ name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'finalized_at', nullable: true })
  finalizedAt: Date;

  @OneToMany(() => EstimateExport, (export_) => export_.estimate)
  exports: EstimateExport[];
}
