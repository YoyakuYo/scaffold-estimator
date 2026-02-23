import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type UserRole = 'admin' | 'estimator' | 'viewer';
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

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: ['admin', 'estimator', 'viewer'], default: 'viewer' })
  role: UserRole;

  @Column({ name: 'first_name', nullable: true })
  firstName: string;

  @Column({ name: 'last_name', nullable: true })
  lastName: string;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ 
    type: 'enum', 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending',
    name: 'approval_status' 
  })
  approvalStatus: ApprovalStatus;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
