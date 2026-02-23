const { Client } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

console.log('Testing database connection...');
console.log('Connection string (without password):', connectionString.replace(/:[^@]+@/, ':****@'));

const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect()
  .then(() => {
    console.log('✅ SUCCESS! Connected to database!');
    return client.query('SELECT version()');
  })
  .then((result) => {
    console.log('Database version:', result.rows[0].version);
    client.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ FAILED! Error:', err.message);
    console.error('Full error:', err);
    client.end();
    process.exit(1);
  });
