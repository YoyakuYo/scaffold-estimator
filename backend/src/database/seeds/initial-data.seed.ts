import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Company } from '../../modules/auth/company.entity';
import { User } from '../../modules/auth/user.entity';
import { CostMasterData } from '../../modules/cost/cost-master.entity';

export async function seedInitialData(dataSource: DataSource): Promise<void> {
  const companyRepository = dataSource.getRepository(Company);
  const userRepository = dataSource.getRepository(User);
  const costMasterRepository = dataSource.getRepository(CostMasterData);

  // Create default company
  let company = await companyRepository.findOne({ where: { name: 'デフォルト建設株式会社' } });
  if (!company) {
    company = companyRepository.create({
      name: 'デフォルト建設株式会社',
      taxId: '1234567890123',
      address: '東京都千代田区1-1-1',
      phone: '03-1234-5678',
      email: 'info@example.com',
    });
    company = await companyRepository.save(company);
    console.log('✓ Created default company');
  }

  // Create admin user
  const adminEmail = 'admin@example.com';
  let adminUser = await userRepository.findOne({ where: { email: adminEmail } });
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    adminUser = userRepository.create({
      companyId: company.id,
      email: adminEmail,
      passwordHash: hashedPassword,
      role: 'superadmin',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      approvalStatus: 'approved', // Admin users are auto-approved
    });
    adminUser = await userRepository.save(adminUser);
    console.log('✓ Created admin user (admin@example.com / admin123)');
  }

  // Create estimator user
  const estimatorEmail = 'estimator@example.com';
  let estimatorUser = await userRepository.findOne({ where: { email: estimatorEmail } });
  if (!estimatorUser) {
    const hashedPassword = await bcrypt.hash('estimator123', 10);
    estimatorUser = userRepository.create({
      companyId: company.id,
      email: estimatorEmail,
      passwordHash: hashedPassword,
      role: 'estimator',
      firstName: 'Estimator',
      lastName: 'User',
      isActive: true,
      approvalStatus: 'approved', // Seed users are auto-approved
    });
    estimatorUser = await userRepository.save(estimatorUser);
    console.log('✓ Created estimator user (estimator@example.com / estimator123)');
  }

  // Create cost master data for Tokyo region
  const currentYear = new Date().getFullYear();
  const tokyoCostData = await costMasterRepository.findOne({
    where: {
      category: 'basic_charge',
      region: '東京',
      fiscalYear: currentYear,
    },
  });

  if (!tokyoCostData) {
    const costData = costMasterRepository.create({
      category: 'basic_charge',
      region: '東京',
      fiscalYear: currentYear,
      materialBasicRate: 5000, // ¥/m²/month
      wearRatePercent: 1.0, // % per day
      transportRate: 500, // ¥ per component
      disposalRatePercent: 5, // % of material value
      surfacePrepRatePercent: 3, // % of material value
      repairRate: 2, // % of material cost
      createdBy: adminUser.id,
    });
    await costMasterRepository.save(costData);
    console.log(`✓ Created cost master data for 東京 region (${currentYear})`);
  }

  console.log('✓ Initial data seeding completed');
}
