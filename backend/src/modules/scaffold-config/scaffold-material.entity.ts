import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Master data for scaffold materials.
 * Prices and specs are stored in DB so they can be updated
 * without code changes.
 */
@Entity('scaffold_materials')
@Index(['scaffoldType', 'category'])
@Index(['code'], { unique: true })
export class ScaffoldMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique material code, e.g. 'WAKU-FRAME-1700', 'NEXTGEN-HR-1829' */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100, name: 'name_jp' })
  nameJp: string;

  @Column({ type: 'varchar', length: 100, name: 'name_en', nullable: true })
  nameEn: string;

  /** Material category: post, horizontal, brace, plank, mesh, jack_base, wall_tie, handrail, handrail_brace, toe_board, stairway, clamp, etc. */
  @Column({ type: 'varchar', length: 50 })
  category: string;

  /** Which scaffold type this material belongs to */
  @Column({ type: 'varchar', length: 20, name: 'scaffold_type' })
  scaffoldType: string;

  /** Size specification label */
  @Column({ type: 'varchar', length: 100, name: 'size_spec' })
  sizeSpec: string;

  /** Unit of measurement */
  @Column({ type: 'varchar', length: 20, default: '本' })
  unit: string;

  /** Standard length in mm */
  @Column({ type: 'int', name: 'standard_length_mm', nullable: true })
  standardLengthMm: number | null;

  /** Standard width in mm */
  @Column({ type: 'int', name: 'standard_width_mm', nullable: true })
  standardWidthMm: number | null;

  /** Weight per unit in kg */
  @Column({ type: 'decimal', precision: 8, scale: 2, name: 'weight_kg', nullable: true })
  weightKg: number | null;

  /** Monthly rental price in JPY */
  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'rental_price_monthly', default: 0 })
  rentalPriceMonthly: number;

  /** Purchase price in JPY (optional) */
  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'purchase_price', nullable: true })
  purchasePrice: number | null;

  /** Bundle quantity for bulk ordering */
  @Column({ type: 'int', name: 'bundle_quantity', nullable: true })
  bundleQuantity: number | null;

  /** Pipe diameter for pipe-based materials */
  @Column({ type: 'decimal', precision: 5, scale: 1, name: 'pipe_diameter_mm', nullable: true })
  pipeDiameterMm: number | null;

  /** Whether this is a combined component (e.g., JFX handrail+brace) */
  @Column({ type: 'boolean', name: 'is_combined', default: false })
  isCombined: boolean;

  /** Whether this material is active/available */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** Sort order for display */
  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
