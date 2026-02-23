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
import { GeometryElement } from './geometry-element.entity';

export type DrawingFileFormat = 'pdf' | 'dxf' | 'dwg' | 'jww' | 'jpg' | 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'svg' | 'tif' | 'tiff';
export type DrawingUploadStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type StructureType = '改修工事' | 'S造' | 'RC造';

@Entity('drawings')
@Index(['projectId', 'uploadedAt'])
export class Drawing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'varchar', length: 255 })
  projectId: string;

  @Column()
  filename: string;

  @Column({ type: 'varchar', length: 10, name: 'file_format' })
  fileFormat: DrawingFileFormat;

  @Column({ name: 'file_path' })
  filePath: string;

  @Column({ name: 'file_size_bytes', type: 'bigint' })
  fileSizeBytes: number;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;

  @Column({ name: 'uploaded_by' })
  uploadedBy: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    scale?: number;
    unit?: 'mm' | 'cm' | 'm';
    bbox?: { minX: number; minY: number; maxX: number; maxY: number };
    layers?: string[];
  };

  @Column({ name: 'detected_structure_type', nullable: true })
  detectedStructureType: StructureType;

  @Column({ name: 'user_confirmed_structure_type', nullable: true })
  userConfirmedStructureType: StructureType;

  @Column({ type: 'jsonb', name: 'normalized_geometry', nullable: true })
  normalizedGeometry: any; // NormalizedGeometry object

  @Column({ type: 'enum', enum: ['pending', 'processing', 'completed', 'failed'], name: 'upload_status', default: 'pending' })
  uploadStatus: DrawingUploadStatus;

  @OneToMany(() => GeometryElement, (element) => element.drawing, { cascade: true })
  geometryElements: GeometryElement[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
