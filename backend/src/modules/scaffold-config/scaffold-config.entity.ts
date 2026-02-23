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
import { Drawing } from '../drawing/drawing.entity';

@Entity('scaffold_configurations')
@Index(['drawingId'])
@Index(['projectId'])
export class ScaffoldConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'varchar', length: 255 })
  projectId: string;

  @Column({ name: 'drawing_id', nullable: true })
  drawingId: string | null;

  @ManyToOne(() => Drawing, { nullable: true })
  @JoinColumn({ name: 'drawing_id' })
  drawing: Drawing;

  // ─── Mode: 'auto' (from drawing) or 'manual' ──────────
  @Column({ type: 'varchar', length: 10, default: 'manual' })
  mode: 'auto' | 'manual';

  // ─── Construction Pattern (構造パターン) ─────────────────
  /** Structure type: 改修工事 (most complex), S造 (medium), RC造 (simplest) */
  @Column({ type: 'varchar', length: 20, name: 'structure_type', default: '改修工事' })
  structureType: '改修工事' | 'S造' | 'RC造';

  // ─── Building Dimensions ────────────────────────────────

  @Column({ type: 'int', name: 'building_height_mm' })
  buildingHeightMm: number;

  // ─── Wall Definitions (JSON) ───────────────────────────
  // Array of { side, wallLengthMm, wallHeightMm, enabled, stairAccessCount, segments? }
  // side can be 'north' | 'south' | 'east' | 'west' or arbitrary edge names for complex polygons
  @Column({ type: 'jsonb', name: 'walls' })
  walls: Array<{
    side: string;
    wallLengthMm: number;
    wallHeightMm: number;
    enabled: boolean;
    stairAccessCount: number;
    /** Optional multi-segment wall definition.
     *  Each segment has a length (along the wall face) and an offset
     *  (perpendicular distance from the base line — positive = outward).
     *  wallLengthMm = sum of segment lengths + return wall transitions.
     */
    segments?: Array<{ lengthMm: number; offsetMm: number }>;
  }>;

  // ─── Scaffold Type ─────────────────────────────────────
  /** Scaffold system: 'kusabi' (くさび式) or 'wakugumi' (枠組) */
  @Column({ type: 'varchar', length: 20, name: 'scaffold_type', default: 'kusabi' })
  scaffoldType: 'kusabi' | 'wakugumi';

  // ─── Scaffold Configuration ─────────────────────────────

  /** Scaffold width (front↔back) in mm: 600, 900, 1200 */
  @Column({ type: 'int', name: 'scaffold_width_mm', default: 600 })
  scaffoldWidthMm: number;

  /** Preferred main tateji size: 1800, 2700, 3600 (kusabi only) */
  @Column({ type: 'int', name: 'preferred_main_tateji_mm', default: 1800 })
  preferredMainTatejiMm: number;

  /** Top guard post height: 900, 1350, 1800 (kusabi only) */
  @Column({ type: 'int', name: 'top_guard_height_mm', default: 900 })
  topGuardHeightMm: number;

  // ─── Wakugumi-specific fields ─────────────────────────────

  /** Frame size (建枠サイズ): 1700, 1800, 1900mm — determines level height for wakugumi */
  @Column({ type: 'int', name: 'frame_size_mm', default: 1700 })
  frameSizeMm: number;

  /** Habaki count per span: 1 or 2 (user-selectable for wakugumi) */
  @Column({ type: 'int', name: 'habaki_count_per_span', default: 2 })
  habakiCountPerSpan: number;

  /** End stopper type: 'nuno' (布材) or 'frame' (枠) — wakugumi only */
  @Column({ type: 'varchar', length: 10, name: 'end_stopper_type', default: 'nuno' })
  endStopperType: 'nuno' | 'frame';

  // ─── Rental Period (Optional - can be set here or in quotation) ───────
  /** Rental period type: weekly, monthly, custom */
  @Column({ type: 'varchar', length: 20, name: 'rental_type', nullable: true })
  rentalType: 'weekly' | 'monthly' | 'custom' | null;

  /** Rental start date */
  @Column({ type: 'date', name: 'rental_start_date', nullable: true })
  rentalStartDate: Date | null;

  /** Rental end date */
  @Column({ type: 'date', name: 'rental_end_date', nullable: true })
  rentalEndDate: Date | null;

  // ─── Results (stored as JSON for quick retrieval) ───────
  @Column({ type: 'jsonb', name: 'calculation_result', nullable: true })
  calculationResult: any;

  // ─── Metadata ──────────────────────────────────────────

  @Column({ name: 'created_by' })
  createdBy: string;

  @Column({ type: 'varchar', length: 20, default: 'configured', name: 'status' })
  status: 'configured' | 'calculated' | 'reviewed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
