import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Company } from '../auth/company.entity';

@Entity('company_branches')
export class CompanyBranch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id' })
  companyId: string;

  @ManyToOne(() => Company, (company) => company.branches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column()
  name: string;

  @Column({ name: 'is_headquarters', default: false })
  isHeadquarters: boolean;

  @Column({ name: 'postal_code', nullable: true })
  postalCode: string;

  @Column({ nullable: true })
  prefecture: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  town: string;

  @Column({ name: 'address_line', nullable: true })
  addressLine: string;

  @Column({ nullable: true })
  building: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  fax: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
