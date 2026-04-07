import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Company } from './company.entity';

export type UserRole = 'superadmin' | 'estimator' | 'viewer';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

@Entity('users')
@Index(['email'])
@Index(['companyId'])
@Index(['approvalStatus'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id' })
  companyId: string;

  /** Optional branch assignment (team invites, admin). */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  /**
   * True when this account is an org seat (e.g. accepted team invite) and must not manage billing checkout.
   * Cleared when the user becomes the organization billing contact on their subscription row.
   */
  @Column({ name: 'is_company_seat', default: false })
  isCompanySeat: boolean;

  /** Exactly one per company: invites, org user management, and billing checkout when applicable. */
  @Column({ name: 'is_company_admin', default: false })
  isCompanyAdmin: boolean;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: Company;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'text', default: 'viewer' })
  role: UserRole;

  @Column({ name: 'first_name', nullable: true })
  firstName: string;

  @Column({ name: 'last_name', nullable: true })
  lastName: string;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'text', default: 'pending', name: 'approval_status' })
  approvalStatus: ApprovalStatus;

  /** Full app access without a paid subscription; set in DB (e.g. Supabase) for lifetime/comp accounts. */
  @Column({ name: 'subscription_exempt', default: false })
  subscriptionExempt: boolean;

  /** After bank-transfer approval: tier to apply once user verifies code. */
  @Column({ name: 'pending_bank_plan', type: 'text', nullable: true })
  pendingBankPlan: 'basic' | 'medium' | 'monthly' | 'premium' | null;

  @Column({ name: 'bank_activation_code_hash', type: 'text', nullable: true })
  bankActivationCodeHash: string | null;

  @Column({ name: 'bank_activation_code_expires_at', type: 'timestamptz', nullable: true })
  bankActivationCodeExpiresAt: Date | null;

  /** Unique wire memo code for /billing bank checkout; cleared after admin confirms funds. */
  @Column({ name: 'bank_wire_reference', type: 'text', nullable: true })
  bankWireReference: string | null;

  /** Plan tier selected for the pending wire (see bank_wire_reference). */
  @Column({ name: 'bank_wire_intent_plan', type: 'text', nullable: true })
  bankWireIntentPlan: 'basic' | 'medium' | 'monthly' | 'premium' | null;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
