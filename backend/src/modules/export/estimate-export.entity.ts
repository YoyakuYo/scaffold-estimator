import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Estimate } from '../estimate/estimate.entity';

export type ExportFormat = 'pdf' | 'excel';

@Entity('estimate_exports')
@Index(['estimateId'])
export class EstimateExport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'estimate_id' })
  estimateId: string;

  @ManyToOne(() => Estimate, (estimate) => estimate.exports)
  @JoinColumn({ name: 'estimate_id' })
  estimate: Estimate;

  @Column({ type: 'enum', enum: ['pdf', 'excel'], name: 'export_format' })
  exportFormat: ExportFormat;

  @Column({ name: 'file_path', nullable: true })
  filePath: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number;

  @CreateDateColumn({ name: 'generated_at' })
  generatedAt: Date;

  @Column({ name: 'generated_by' })
  generatedBy: string;

  @Column({ name: 's3_url', nullable: true })
  s3Url: string;

  @Column({ name: 'expires_at', nullable: true })
  expiresAt: Date;
}
