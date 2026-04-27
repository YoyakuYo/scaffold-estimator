import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { ElementLineKind, ExtractionSource, StructuralElementType } from './element-types';

/** Per-set × per-floor × per-block × per-type extracted quantity row. */
@Entity('extracted_elements')
@Index(['setId', 'level', 'block', 'elementType'])
export class ExtractedElement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'set_id', type: 'uuid' })
  setId: string;

  @Column({ type: 'text' })
  level: string;

  @Column({ type: 'text', nullable: true })
  block: string | null;

  @Column({ name: 'element_type', type: 'text' })
  elementType: StructuralElementType;

  @Column({ type: 'text', nullable: true })
  label: string | null;

  @Column({ type: 'text', nullable: true })
  section: string | null;

  @Column({ type: 'integer', default: 0 })
  qty: number;

  /** Single-piece length (mm); null → default length for `elementType` in scheduling / steel rollups. */
  @Column({ name: 'piece_length_mm', type: 'int', nullable: true })
  pieceLengthMm: number | null;

  @Column({ type: 'text', nullable: true })
  phase: string | null;

  @Column({ type: 'text', nullable: true })
  shop: string | null;

  @Column({ name: 'line_kind', type: 'text', default: 'member' })
  lineKind: ElementLineKind;

  @Column({ name: 'extraction_confidence', type: 'float', nullable: true })
  extractionConfidence: number | null;

  @Column({ name: 'needs_review', type: 'boolean', default: false })
  needsReview: boolean;

  @Column({ type: 'text', nullable: true })
  grid: string | null;

  @Column({ type: 'text', default: 'manual' })
  source: ExtractionSource;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
