# Quick Start Guide
## Scaffolding Estimation Platform

Get your platform up and running in 10 minutes!

---

## Prerequisites

- Node.js 18+ installed
- npm or yarn installed
- Supabase account (free tier works)
- Redis instance (Upstash free tier recommended)

---

## Step 1: Clone & Install (2 minutes)

```bash
cd backend
npm install
```

---

## Step 2: Set Up Supabase (3 minutes)

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Click "New Project"
   - Name: `scaffolding-estimation`
   - Region: `Northeast Asia (Tokyo)`
   - Save your database password!

2. **Get Connection Details**
   - Settings → Database
   - Copy connection string
   - Settings → API → Copy keys

3. **Enable Extensions**
   - SQL Editor → New Query
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```
   - Click "Run"

---

## Step 3: Configure Environment (2 minutes)

1. **Create `.env` file:**
   ```bash
   cd backend
   # Copy the template
   cp ENV_SETUP.md .env
   ```

2. **Edit `.env` with your values:**
   ```bash
   # Database (from Supabase)
   DB_HOST=db.xxxxx.supabase.co
   DB_PORT=5432
   DB_USERNAME=postgres
   DB_PASSWORD=your-password-here
   DB_NAME=postgres

   # JWT (generate secrets)
   JWT_SECRET=your-secret-here
   JWT_REFRESH_SECRET=your-refresh-secret-here

   # Redis (Upstash free tier)
   REDIS_HOST=your-redis.upstash.io
   REDIS_PORT=6379
   REDIS_PASSWORD=your-token

   # Supabase Storage
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-key
   ```

3. **Generate JWT Secrets:**
   ```bash
   # Linux/Mac
   openssl rand -base64 32
   
   # Windows PowerShell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
   ```

---

## Step 4: Set Up Redis (2 minutes)

1. **Sign up at [upstash.com](https://upstash.com)**
2. **Create Redis Database**
   - Free tier is sufficient
   - Choose same region as Supabase
3. **Copy connection details to `.env`**

---

## Step 5: Run Migrations (1 minute)

```bash
npm run migration:run
```

Verify in Supabase Dashboard → Table Editor (should see 9 tables)

---

## Step 6: Seed Initial Data (30 seconds)

```bash
npm run seed
```

This creates:
- Default company
- Admin: `admin@example.com` / `admin123`
- Estimator: `estimator@example.com` / `estimator123`

**⚠️ Change passwords in production!**

---

## Step 7: Start Server (30 seconds)

```bash
npm run start:dev
```

Server runs on `http://localhost:3000`

---

## Step 8: Test API (1 minute)

### Test Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

You should get a JWT token!

### Test Health (if endpoint exists)
```bash
curl http://localhost:3000/api/v1/health
```

---

## ✅ You're Done!

Your platform is now running. Next steps:

1. **Read Full Documentation:**
   - `SUPABASE_IMPLEMENTATION_REPORT.md` - Complete setup guide
   - `backend/README.md` - API documentation

2. **Explore API Endpoints:**
   - Upload drawings: `POST /api/v1/drawings/upload`
   - Create estimates: `POST /api/v1/estimates`
   - Generate exports: `POST /api/v1/exports/estimates/:id`

3. **Set Up Frontend:**
   - Connect frontend to `http://localhost:3000`
   - Use JWT token for authentication

---

## Troubleshooting

**Migration fails?**
- Check database connection in `.env`
- Verify extensions are enabled
- Check Supabase dashboard for errors

**Can't connect to Redis?**
- Verify Redis credentials
- Test connection: `redis-cli -h HOST -p PORT -a PASSWORD ping`

**JWT errors?**
- Ensure JWT secrets are set in `.env`
- Check token expiration settings

---

## Need Help?

- 📖 See `SUPABASE_IMPLEMENTATION_REPORT.md` for detailed setup
- 📖 See `backend/MIGRATION_GUIDE.md` for database help
- 📖 See `IMPLEMENTATION_COMPLETE.md` for feature overview

---

**Total Setup Time**: ~10 minutes
**Status**: ✅ Ready for development
