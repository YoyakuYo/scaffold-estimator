import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { ClassificationSource, DrawingKind } from './element-types';

/** One file inside a `DrawingSet`. */
@Entity('drawing_set_files')
@Index(['setId', 'createdAt'])
export class DrawingSetFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'set_id', type: 'uuid' })
  setId: string;

  @Column({ type: 'text' })
  filename: string;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | number | null;

  @Column({ name: 'storage_path', type: 'text', nullable: true })
  storagePath: string | null;

  @Column({ type: 'text', nullable: true })
  kind: DrawingKind | null;

  @Column({ type: 'text', nullable: true })
  level: string | null;

  @Column({ type: 'text', nullable: true })
  block: string | null;

  @Column({ name: 'classification_source', type: 'text', default: 'auto' })
  classificationSource: ClassificationSource;

  @Column({ name: 'classification_confidence', type: 'real', nullable: true })
  classificationConfidence: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
