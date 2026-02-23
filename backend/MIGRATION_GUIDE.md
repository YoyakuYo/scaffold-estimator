# Database Migration Guide

## Overview

This project uses TypeORM migrations to manage database schema changes. All migrations are located in `src/database/migrations/`.

## Initial Migration

The initial migration (`1700000000001-InitialSchema.ts`) creates all core tables:

- `companies` - Company information
- `users` - User accounts with roles
- `drawings` - Uploaded CAD files
- `geometry_elements` - Parsed geometry data
- `estimates` - Estimate records
- `cost_line_items` - Cost breakdown items
- `cost_master_data` - Admin-editable cost rates
- `estimate_exports` - Generated PDF/Excel files
- `audit_log` - Audit trail

## Running Migrations

### Prerequisites

1. Ensure your `.env` file is configured with database credentials
2. Database must be accessible
3. Required PostgreSQL extensions must be enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```

### Run Migrations

```bash
# Run all pending migrations
npm run migration:run
```

### Generate New Migration

After modifying entities:

```bash
# Generate migration from entity changes
npm run migration:generate -- src/database/migrations/MigrationName
```

### Revert Last Migration

```bash
# Revert the most recent migration
npm run migration:revert
```

## Migration Files

- `1700000000001-InitialSchema.ts` - Creates all initial tables and indexes

## Verifying Migrations

### Check Migration Status

Connect to your database and run:

```sql
SELECT * FROM typeorm_migrations ORDER BY timestamp DESC;
```

### Verify Tables

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

## Troubleshooting

### Migration Fails: Extension Not Found

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Migration Fails: Permission Denied

Ensure your database user has:
- CREATE TABLE permission
- CREATE INDEX permission
- ALTER TABLE permission

### Migration Fails: Table Already Exists

If tables already exist, you can:
1. Drop existing tables (⚠️ **WARNING**: This deletes data!)
2. Or modify migration to use `IF NOT EXISTS` checks

## Production Considerations

1. **Always backup database before running migrations**
2. **Test migrations on staging environment first**
3. **Run migrations during maintenance window**
4. **Monitor migration execution time**
5. **Have rollback plan ready**

## Seeding Data

After migrations, seed initial data:

```bash
npm run seed
```

This creates:
- Default company
- Admin and estimator users
- Initial cost master data
