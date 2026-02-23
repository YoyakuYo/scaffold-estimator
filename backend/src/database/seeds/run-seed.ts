import { DataSource } from 'typeorm';
import dataSource from '../data-source';
import { seedInitialData } from './initial-data.seed';

async function runSeed() {
  try {
    console.log('Connecting to database...');
    await dataSource.initialize();
    console.log('✓ Database connected');

    console.log('Running seed...');
    await seedInitialData(dataSource);

    await dataSource.destroy();
    console.log('✓ Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

runSeed();
