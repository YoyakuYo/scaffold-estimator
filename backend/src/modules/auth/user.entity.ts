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

  /** Full app access without Stripe; set in DB (e.g. Supabase) for lifetime/comp accounts. */
  @Column({ name: 'subscription_exempt', default: false })
  subscriptionExempt: boolean;

  /** After bank-transfer approval: tier to apply once user verifies code. */
  @Column({ name: 'pending_bank_plan', type: 'text', nullable: true })
  pendingBankPlan: 'basic' | 'medium' | 'premium' | null;

  @Column({ name: 'bank_activation_code_hash', type: 'text', nullable: true })
  bankActivationCodeHash: string | null;

  @Column({ name: 'bank_activation_code_expires_at', type: 'timestamptz', nullable: true })
  bankActivationCodeExpiresAt: Date | null;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
