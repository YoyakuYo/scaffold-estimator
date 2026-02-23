# Environment Variables Setup Guide

Copy this content to create your `.env` file in the `backend/` directory.

```bash
# ============================================
# DATABASE CONFIGURATION (Supabase)
# ============================================
# Get these from Supabase Dashboard → Settings → Database
# Use connection pooler for better performance (recommended)
DB_HOST=db.xxxxx.supabase.co
# OR use pooler: aws-0-ap-northeast-1.pooler.supabase.com
DB_PORT=5432
# OR use pooler port: 6543
DB_USERNAME=postgres
DB_PASSWORD=your-supabase-database-password-here
DB_NAME=postgres

# ============================================
# JWT CONFIGURATION
# ============================================
# Generate secure secrets: openssl rand -base64 32
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=3600
JWT_REFRESH_SECRET=your-refresh-secret-key-also-change-this
JWT_REFRESH_EXPIRES_IN=86400

# ============================================
# REDIS CONFIGURATION
# ============================================
# Option 1: Upstash Redis (recommended for production)
# REDIS_HOST=your-redis.upstash.io
# REDIS_PORT=6379
# REDIS_PASSWORD=your-upstash-token

# Option 2: Redis Cloud
# REDIS_HOST=redis-xxxxx.cloud.redislabs.com
# REDIS_PORT=12345
# REDIS_PASSWORD=your-redis-password

# Option 3: Local Redis (development)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ============================================
# FILE STORAGE CONFIGURATION
# ============================================
# Option 1: Supabase Storage (recommended)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Option 2: AWS S3 (alternative)
# AWS_REGION=ap-northeast-1
# AWS_ACCESS_KEY_ID=your-aws-access-key
# AWS_SECRET_ACCESS_KEY=your-aws-secret-key
# AWS_S3_BUCKET=scaffolding-estimation-files

# ============================================
# APPLICATION CONFIGURATION
# ============================================
PORT=3000
NODE_ENV=development
# For production, set: NODE_ENV=production
FRONTEND_URL=http://localhost:3001

# File Upload Limits
MAX_FILE_SIZE=524288000
ALLOWED_FILE_TYPES=pdf,dxf,dwg
```

## Quick Setup Steps

1. **Create `.env` file:**
   ```bash
   cd backend
   cp ENV_SETUP.md .env
   # Then edit .env with your actual values
   ```

2. **Get Supabase credentials:**
   - Go to Supabase Dashboard → Settings → Database
   - Copy connection string details
   - Go to Settings → API for keys

3. **Generate JWT secrets:**
   ```bash
   # Linux/Mac
   openssl rand -base64 32
   
   # Windows PowerShell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
   ```

4. **Set up Redis:**
   - Use Upstash (free tier) for production
   - Or use local Redis for development
