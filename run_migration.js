const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL environment variable not found');
  console.error('Please ensure your .env file is configured with database credentials');
  process.exit(1);
}

console.log('🔄 Running RLS migration...');
console.log('Connection string (without password):', connectionString.replace(/:[^@]+@/, ':****@'));

const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

const migrationFile = path.join(__dirname, 'supabase-migrations', '013_enable_rls_scaffold_tables.sql');

client.connect()
  .then(() => {
    console.log('✅ Connected to database!');

    // Read the migration SQL file
    const sql = fs.readFileSync(migrationFile, 'utf8');
    console.log('📄 Read migration file:', migrationFile);

    // Execute the SQL
    return client.query(sql);
  })
  .then((result) => {
    console.log('✅ SUCCESS! Migration executed successfully');
    console.log('Result:', result.rowCount ? `${result.rowCount} rows affected` : 'DDL commands executed');
    client.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ FAILED! Error executing migration:', err.message);
    console.error('Full error:', err);
    client.end();
    process.exit(1);
  });