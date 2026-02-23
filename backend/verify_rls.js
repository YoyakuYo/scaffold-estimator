const { Client } = require('pg');
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL environment variable not found');
  process.exit(1);
}

console.log('🔍 Verifying RLS status on tables...');

const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect()
  .then(() => {
    console.log('✅ Connected to database!');

    // Query to check RLS status on all tables
    const sql = `
      SELECT
        schemaname,
        tablename,
        rowsecurity as rls_enabled
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'calculated_quantities',
          'quotations',
          'quotation_items',
          'scaffold_materials',
          'scaffold_configurations',
          'companies',
          'users',
          'drawings',
          'geometry_elements',
          'estimates',
          'cost_line_items',
          'cost_master_data',
          'estimate_exports',
          'audit_log'
        )
      ORDER BY tablename;
    `;

    return client.query(sql);
  })
  .then((result) => {
    console.log('📊 RLS Status Report:');
    console.log('─'.repeat(50));

    let allEnabled = true;
    result.rows.forEach(row => {
      const status = row.rls_enabled ? '✅ ENABLED' : '❌ DISABLED';
      console.log(`${row.tablename.padEnd(25)} ${status}`);
      if (!row.rls_enabled) {
        allEnabled = false;
      }
    });

    console.log('─'.repeat(50));

    if (allEnabled) {
      console.log('🎉 SUCCESS! All tables have RLS enabled');
    } else {
      console.log('⚠️  WARNING! Some tables still have RLS disabled');
    }

    client.end();
    process.exit(allEnabled ? 0 : 1);
  })
  .catch((err) => {
    console.error('❌ FAILED! Error checking RLS status:', err.message);
    console.error('Full error:', err);
    client.end();
    process.exit(1);
  });