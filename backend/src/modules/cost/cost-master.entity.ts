import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type CostCategory = 'basic_charge' | 'damage_charge' | 'transport' | 'loss' | 'cleaning' | 'repair' | 'other';

@Entity('cost_master_data')
@Index(['category', 'region', 'fiscalYear'])
export class CostMasterData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['basic_charge', 'damage_charge', 'transport', 'loss', 'cleaning', 'repair', 'other'] })
  category: CostCategory;

  @Column()
  region: string; // e.g., '東京', '大阪'

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear: number;

  @Column({ name: 'material_basic_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  materialBasicRate: number; // ¥/m²/month

  @Column({ name: 'damage_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  damageRate: number; // ¥/m²/month

  @Column({ name: 'transport_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  transportRate: number; // ¥/m² or fixed

  @Column({ name: 'cleaning_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  cleaningRate: number; // ¥/m²

  @Column({ name: 'repair_rate', type: 'decimal', precision: 5, scale: 2, nullable: true })
  repairRate: number; // % of material cost

  @Column({ name: 'wear_rate_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
  wearRatePercent: number; // % per day

  @Column({ name: 'disposal_rate_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
  disposalRatePercent: number; // % of material value

  @Column({ name: 'surface_prep_rate_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
  surfacePrepRatePercent: number; // % of material value

  @Column({ type: 'jsonb', name: 'audit_log', nullable: true })
  auditLog: Array<{
    user: string;
    timestamp: Date;
    oldValue: any;
    newValue: any;
    field: string;
  }>;

  @Column({ name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
