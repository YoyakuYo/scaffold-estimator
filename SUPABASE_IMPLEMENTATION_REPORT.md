# Supabase Implementation Report
## Scaffolding Estimation Platform - Production Setup Guide

This document provides step-by-step instructions for setting up the scaffolding estimation platform on Supabase and configuring all required environment variables.

---

## Table of Contents

1. [Supabase Project Setup](#supabase-project-setup)
2. [Database Configuration](#database-configuration)
3. [Environment Variables](#environment-variables)
4. [Running Migrations](#running-migrations)
5. [Seeding Initial Data](#seeding-initial-data)
6. [Storage Setup (Optional)](#storage-setup-optional)
7. [Redis Setup](#redis-setup)
8. [Deployment Checklist](#deployment-checklist)

---

## 1. Supabase Project Setup

### Step 1: Create a Supabase Project

1. **Sign up/Login to Supabase**
   - Go to [https://supabase.com](https://supabase.com)
   - Sign up for a free account or log in

2. **Create New Project**
   - Click "New Project" button
   - Fill in project details:
     - **Name**: `scaffolding-estimation-platform` (or your preferred name)
     - **Database Password**: Create a strong password (save this securely!)
     - **Region**: Choose closest to your users (e.g., `Northeast Asia (Tokyo)` for Japan)
     - **Pricing Plan**: Start with Free tier for development

3. **Wait for Project Creation**
   - Supabase will provision your PostgreSQL database (takes ~2 minutes)
   - You'll see a dashboard when ready

### Step 2: Get Database Connection Details

1. **Navigate to Project Settings**
   - Click the gear icon (⚙️) in the left sidebar
   - Go to "Database" section

2. **Find Connection String**
   - Scroll to "Connection string" section
   - Select "URI" tab
   - Copy the connection string (it looks like):
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
     ```

3. **Get Connection Pooling String (Recommended)**
   - Use "Session mode" connection string for better performance
   - This uses Supabase's connection pooler
   - Format: `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`

4. **Save These Values:**
   - Database Host: `db.xxxxx.supabase.co` (or pooler host)
   - Database Port: `5432` (or `6543` for pooler)
   - Database Name: `postgres`
   - Database User: `postgres`
   - Database Password: (the one you created)

---

## 2. Database Configuration

### Enable Required PostgreSQL Extensions

1. **Open SQL Editor**
   - In Supabase dashboard, click "SQL Editor" in left sidebar
   - Click "New query"

2. **Run Extension Commands**
   ```sql
   -- Enable UUID extension (usually enabled by default)
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   
   -- Enable gen_random_uuid() function
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```

3. **Click "Run"** to execute

### Verify Database Access

You can test the connection using the Supabase SQL Editor or any PostgreSQL client.

---

## 3. Environment Variables

### Create `.env` File

In your `backend/` directory, create a `.env` file with the following variables:

```bash
# ============================================
# DATABASE CONFIGURATION (Supabase)
# ============================================
# Use the connection details from Supabase dashboard
DB_HOST=db.xxxxx.supabase.co
# OR use connection pooler (recommended for production):
# DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com

DB_PORT=5432
# OR use pooler port:
# DB_PORT=6543

DB_USERNAME=postgres
DB_PASSWORD=your-supabase-database-password-here
DB_NAME=postgres

# For production, Supabase uses SSL
# Set NODE_ENV=production to enable SSL
NODE_ENV=production

# ============================================
# JWT CONFIGURATION
# ============================================
# Generate a strong random secret (use: openssl rand -base64 32)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=3600
JWT_REFRESH_SECRET=your-refresh-secret-key-also-change-this
JWT_REFRESH_EXPIRES_IN=86400

# ============================================
# REDIS CONFIGURATION
# ============================================
# Option 1: Use Supabase Redis (if available) or external Redis
# Option 2: Use Upstash Redis (free tier available)
# Option 3: Use local Redis for development
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# For Upstash Redis (example):
# REDIS_HOST=your-redis.upstash.io
# REDIS_PORT=6379
# REDIS_PASSWORD=your-upstash-password

# ============================================
# AWS S3 / FILE STORAGE
# ============================================
# Option 1: Use Supabase Storage (recommended)
# Option 2: Use AWS S3
# Option 3: Use local storage for development

# For Supabase Storage (use Supabase API):
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# For AWS S3 (alternative):
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=scaffolding-estimation-files

# ============================================
# APPLICATION CONFIGURATION
# ============================================
PORT=3000
FRONTEND_URL=http://localhost:3001

# File Upload Limits
MAX_FILE_SIZE=524288000
ALLOWED_FILE_TYPES=pdf,dxf,dwg
```

### Getting Supabase Keys

1. **Go to Project Settings** → **API**
2. **Copy the following:**
   - **Project URL**: `https://xxxxx.supabase.co` → Use for `SUPABASE_URL`
   - **anon/public key**: → Use for `SUPABASE_ANON_KEY` (if using Supabase Storage client-side)
   - **service_role key**: → Use for `SUPABASE_SERVICE_ROLE_KEY` (for server-side operations)
     - ⚠️ **Keep this secret!** Never expose in client-side code

### Generating JWT Secrets

Generate secure random secrets:

```bash
# On Linux/Mac:
openssl rand -base64 32

# On Windows (PowerShell):
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

Use different secrets for `JWT_SECRET` and `JWT_REFRESH_SECRET`.

---

## 4. Running Migrations

### Install Dependencies

```bash
cd backend
npm install
```

### Run Migrations

```bash
# Run all pending migrations
npm run migration:run
```

This will create all database tables:
- `companies`
- `users`
- `drawings`
- `geometry_elements`
- `estimates`
- `cost_line_items`
- `cost_master_data`
- `estimate_exports`
- `audit_log`

### Verify Migration Success

1. **Check Supabase Dashboard**
   - Go to "Table Editor" in left sidebar
   - You should see all tables listed

2. **Or use SQL Editor:**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public';
   ```

---

## 5. Seeding Initial Data

### Run Seed Script

```bash
npm run seed
```

This creates:
- ✅ Default company: `デフォルト建設株式会社`
- ✅ Admin user: `admin@example.com` / `admin123`
- ✅ Estimator user: `estimator@example.com` / `estimator123`
- ✅ Cost master data for 東京 region

### ⚠️ Security Note

**Change default passwords immediately in production!**

You can update passwords via SQL:

```sql
-- Update admin password (replace 'newpassword' with bcrypt hash)
UPDATE users 
SET password_hash = '$2b$10$...' 
WHERE email = 'admin@example.com';
```

Or create new users through the API after first login.

---

## 6. Storage Setup (Optional)

### Option A: Use Supabase Storage (Recommended)

1. **Enable Storage**
   - Go to "Storage" in Supabase dashboard
   - Create a new bucket named `drawings`
   - Set bucket to **Private** (requires authentication)
   - Create another bucket `exports` for PDF/Excel files

2. **Configure Storage Policies**
   - Go to "Policies" tab for each bucket
   - Create policy for authenticated users to upload/read

3. **Update Code** (if needed)
   - Modify `drawing.service.ts` to use Supabase Storage API
   - Use `@supabase/supabase-js` package

### Option B: Use AWS S3

1. **Create S3 Bucket**
   - Go to AWS Console → S3
   - Create bucket: `scaffolding-estimation-files`
   - Region: `ap-northeast-1` (Tokyo)

2. **Configure IAM User**
   - Create IAM user with S3 access
   - Generate access keys
   - Add to `.env` file

### Option C: Local Storage (Development Only)

For development, files are stored in `./uploads` and `./exports` directories.

---

## 7. Redis Setup

### Option A: Upstash Redis (Recommended for Production)

1. **Sign up at [upstash.com](https://upstash.com)**
2. **Create Redis Database**
   - Choose region closest to your Supabase region
   - Select "Regional" for better performance
3. **Copy Connection Details**
   - Get REST URL and token
   - Add to `.env`:
     ```bash
     REDIS_HOST=your-redis.upstash.io
     REDIS_PORT=6379
     REDIS_PASSWORD=your-upstash-token
     ```

### Option B: Redis Cloud

1. Sign up at [redis.com/cloud](https://redis.com/cloud)
2. Create free database
3. Copy connection string to `.env`

### Option C: Local Redis (Development)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally
# macOS: brew install redis
# Ubuntu: sudo apt-get install redis-server
```

---

## 8. Deployment Checklist

### Pre-Deployment

- [ ] Supabase project created and database accessible
- [ ] All environment variables configured in `.env`
- [ ] Database migrations run successfully
- [ ] Initial data seeded
- [ ] Redis instance configured and accessible
- [ ] File storage configured (Supabase Storage or S3)
- [ ] JWT secrets generated and secure
- [ ] Default passwords changed

### Application Deployment

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Start production server:**
   ```bash
   npm run start:prod
   ```

3. **Or use PM2 for process management:**
   ```bash
   npm install -g pm2
   pm2 start dist/main.js --name scaffolding-api
   pm2 save
   pm2 startup
   ```

### Environment-Specific Configuration

**Development:**
```bash
NODE_ENV=development
# Use local Redis, local file storage
```

**Production:**
```bash
NODE_ENV=production
# Use Supabase database with SSL
# Use Upstash Redis
# Use Supabase Storage or S3
```

---

## 9. Testing the Setup

### Test Database Connection

```bash
# Test from command line (if psql installed)
psql "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

# Or test via API
curl http://localhost:3000/api/v1/health
```

### Test Authentication

```bash
# Login as admin
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

### Test File Upload

```bash
# Upload a test drawing (requires JWT token from login)
curl -X POST http://localhost:3000/api/v1/drawings/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test-drawing.pdf" \
  -F "projectId=test-project-id"
```

---

## 10. Troubleshooting

### Common Issues

**Issue: Connection timeout to Supabase**
- ✅ Check if IP is whitelisted (Supabase → Settings → Database → Connection Pooling)
- ✅ Verify connection string format
- ✅ Check firewall settings

**Issue: Migration fails**
- ✅ Ensure extensions are enabled (`uuid-ossp`, `pgcrypto`)
- ✅ Check database user has CREATE permissions
- ✅ Verify connection string is correct

**Issue: Redis connection fails**
- ✅ Verify Redis host and port
- ✅ Check Redis password
- ✅ Test connection: `redis-cli -h HOST -p PORT -a PASSWORD ping`

**Issue: File upload fails**
- ✅ Check file size limits
- ✅ Verify storage bucket exists and has correct permissions
- ✅ Check disk space (if using local storage)

---

## 11. Security Best Practices

1. **Never commit `.env` file**
   - Already in `.gitignore`
   - Use environment variables in production

2. **Rotate secrets regularly**
   - JWT secrets
   - Database passwords
   - API keys

3. **Use connection pooling**
   - Supabase pooler reduces connection overhead
   - Better for serverless deployments

4. **Enable Row Level Security (RLS)** (if using Supabase directly)
   - Add RLS policies for multi-tenant security

5. **Monitor API usage**
   - Set up Supabase dashboard alerts
   - Monitor Redis usage

---

## 12. Next Steps

After setup is complete:

1. ✅ Test all API endpoints
2. ✅ Set up monitoring (Supabase dashboard, application logs)
3. ✅ Configure backups (Supabase handles this automatically)
4. ✅ Set up CI/CD pipeline
5. ✅ Deploy frontend application
6. ✅ Configure custom domain (if needed)

---

## Support & Resources

- **Supabase Docs**: [https://supabase.com/docs](https://supabase.com/docs)
- **TypeORM Migrations**: [https://typeorm.io/migrations](https://typeorm.io/migrations)
- **Project README**: See `backend/README.md`

---

**Last Updated**: 2024
**Version**: 1.0.0
