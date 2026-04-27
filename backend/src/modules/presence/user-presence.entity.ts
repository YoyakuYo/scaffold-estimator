import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Live presence row, one per logged-in user.
 * Backend upserts on every heartbeat (every ~30s from frontend) and on every recorded action.
 * "Online" = `updatedAt` within the last 3 minutes.
 */
@Entity('user_presence')
export class UserPresence {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Stable key like `'scaffold/list'`, `'scaffold/result/<id>'`, `'dashboard'`. */
  @Column({ name: 'page_key', type: 'text', nullable: true })
  pageKey: string | null;

  /** Human-readable label set per page, e.g. "Scaffold: Tokyo Bldg - Configure walls". */
  @Column({ type: 'text', nullable: true })
  label: string | null;

  /** Most recent meaningful action, e.g. "uploaded plan.pdf", "calculated", "exported Excel". */
  @Column({ name: 'last_action', type: 'text', nullable: true })
  lastAction: string | null;

  @Column({ name: 'last_action_at', type: 'timestamptz', nullable: true })
  lastActionAt: Date | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
