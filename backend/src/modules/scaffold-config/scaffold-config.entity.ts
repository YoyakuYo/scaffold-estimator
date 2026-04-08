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

  /** Job site / project name (optional, for quotation header) */
  @Column({ type: 'varchar', length: 255, name: 'site_name', nullable: true })
  siteName: string | null;

  @Column({ type: 'text', name: 'site_address', nullable: true })
  siteAddress: string | null;

  @Column({ type: 'varchar', length: 255, name: 'site_email', nullable: true })
  siteEmail: string | null;

  @Column({ type: 'varchar', length: 100, name: 'site_phone', nullable: true })
  sitePhone: string | null;

  @Column({ type: 'varchar', length: 100, name: 'site_fax', nullable: true })
  siteFax: string | null;

  // ─── Wall Definitions (JSON) ───────────────────────────
  // Array of { side, wallLengthMm, wallHeightMm, enabled, stairAccessCount, scaffoldWidthMm?, segments? }
  // side can be 'north' | 'south' | 'east' | 'west' or arbitrary edge names for complex polygons
  @Column({ type: 'jsonb', name: 'walls' })
  walls: Array<{
    side: string;
    wallLengthMm: number;
    wallHeightMm: number;
    enabled: boolean;
    stairAccessCount: number;
    /** Per-wall scaffold width (610/914/1219). Overrides global scaffoldWidthMm when set. */
    scaffoldWidthMm?: number;
    /** Optional multi-segment wall definition.
     *  Each segment has a length (along the wall face) and an offset
     *  (perpendicular distance from the base line — positive = outward).
     *  wallLengthMm = sum of segment lengths + return wall transitions.
     */
    segments?: Array<{ lengthMm: number; offsetMm: number }>;
    /** Tier base elevation (mm). For stepped buildings, scaffold starts here. */
    baseHeightMm?: number;
    /** Logical side for BOM grouping (e.g. 'east' groups east-T1..east-TN). */
    tierGroup?: string;
    /** Tier index (0-based) within the tierGroup. */
    tierIndex?: number;
  }>;

  // ─── Scaffold Type ─────────────────────────────────────
  /** Scaffold system: 'kusabi' (くさび式) or 'wakugumi' (枠組) */
  @Column({ type: 'varchar', length: 20, name: 'scaffold_type', default: 'kusabi' })
  scaffoldType: 'kusabi' | 'wakugumi';

  // ─── Scaffold Configuration ─────────────────────────────

  /** Scaffold width (front↔back) in mm: 610, 914, 1219 */
  @Column({ type: 'int', name: 'scaffold_width_mm', default: 610 })
  scaffoldWidthMm: number;

  /** Distance from building wall to inner posts in mm. Always 300mm in 3D view. */
  @Column({ type: 'int', name: 'wall_standoff_mm', default: 300 })
  wallStandoffMm: number;

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

  /** Wakugumi 端部 — persisted as `nuno` (legacy `frame` rows are normalized on recalculate). */
  @Column({ type: 'varchar', length: 10, name: 'end_stopper_type', default: 'nuno' })
  endStopperType: string;

  /** Wakugumi walk-through frame line: FT-617 / FT-917 / FT-1217 (width between posts) */
  @Column({ type: 'varchar', length: 10, name: 'wakugumi_frame_series', default: 'FT917' })
  wakugumiFrameSeries: 'FT617' | 'FT917' | 'FT1217';

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
