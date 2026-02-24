# Deployment Guide: Scaffolding Estimation Platform (100% FREE)

This guide covers how to create a GitHub repository and deploy both the backend and frontend of the Scaffolding Estimation Platform using **completely FREE services**. No credit card required!

> **💰 All options in this guide are 100% FREE** - perfect for personal projects, demos, and small applications.

---

## Table of Contents

1. [Creating a GitHub Repository](#1-creating-a-github-repository)
2. [Backend Deployment](#2-backend-deployment)
3. [Frontend Deployment](#3-frontend-deployment)
4. [Post-Deployment Configuration](#4-post-deployment-configuration)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Creating a GitHub Repository

### Step 1: Prepare Your Project

Before pushing to GitHub, ensure you have a `.gitignore` file in the root directory to exclude sensitive files and dependencies.

**Create `.gitignore` in the root directory:**

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/
.nyc_output

# Production
dist/
build/
.next/
out/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Uploads and temporary files
uploads/
*.tmp
*.temp

# Database
*.sqlite
*.db

# TypeScript
*.tsbuildinfo

# Misc
.cache/
.temp/
```

### Step 2: Create Repository on GitHub

1. **Go to GitHub**: Visit [https://github.com](https://github.com) and sign in
2. **Click "New Repository"**: Click the "+" icon in the top right, then "New repository"
3. **Repository Settings**:
   - **Name**: `scaffolding-estimation-platform` (or your preferred name)
   - **Description**: "Scaffolding estimation platform for Japanese construction companies"
   - **Visibility**: Choose Private (recommended) or Public
   - **DO NOT** initialize with README, .gitignore, or license (you already have these)
4. **Click "Create repository"**

### Step 3: Initialize Git and Push to GitHub

Open your terminal in the project root directory and run:

```bash
# Initialize git repository (if not already initialized)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Scaffolding estimation platform"

# Add remote repository (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/scaffolding-estimation-platform.git

# Rename default branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

**Note**: If you're using SSH instead of HTTPS:
```bash
git remote add origin git@github.com:YOUR_USERNAME/scaffolding-estimation-platform.git
```

### Step 4: Verify Repository

1. Go to your repository on GitHub
2. Verify all files are present
3. Check that `.env` files are NOT included (they should be in `.gitignore`)

---

## 2. Backend Deployment (100% FREE Options)

The backend is a **NestJS** application that requires:
- Node.js runtime
- PostgreSQL database (Supabase - FREE)
- Redis (for job queue - FREE options available)
- Environment variables

> **Note**: All options below are completely FREE. Some may have limitations (like sleeping after inactivity), but they cost $0.

---

### Option A: Render (Recommended - Completely FREE)

**Render** offers a completely free tier with PostgreSQL and Redis support. The free tier sleeps after 15 minutes of inactivity but wakes up automatically when accessed.

#### Steps:

1. **Sign up**: Go to [https://render.com](https://render.com) and sign up with GitHub (FREE)
2. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Settings:
     - **Name**: `scaffolding-backend`
     - **Root Directory**: `backend`
     - **Environment**: `Node`
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm run start:prod`
     - **Plan**: **FREE** (select Free tier)
3. **Add PostgreSQL Database** (FREE):
   - Click "New +" → "PostgreSQL"
   - Name: `scaffolding-db`
   - **Plan: FREE** (90 days free, then $7/month - but you can export data and recreate)
   - **OR use Supabase PostgreSQL (completely free forever)** - see below
4. **Add Redis Instance** (FREE):
   - Click "New +" → "Redis"
   - Name: `scaffolding-redis`
   - **Plan: FREE** (30 days free, then $10/month)
   - **OR use Upstash Redis (completely free forever)** - see below
5. **Configure Environment Variables**:
   - Go to your web service → "Environment"
   - Add variables (Render provides connection strings):

```bash
# Database (from Render PostgreSQL OR Supabase)
DB_HOST=your-postgres-host.onrender.com
DB_PORT=5432
DB_USERNAME=your-username
DB_PASSWORD=your-password
DB_NAME=your-database-name

# Redis (from Render Redis OR Upstash)
REDIS_HOST=your-redis-host.onrender.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=3600
JWT_REFRESH_SECRET=your-super-secret-refresh-key
JWT_REFRESH_EXPIRES_IN=86400

# Application
PORT=10000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com

# File Storage (Supabase Storage - FREE)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-key
```

   **⚠️ Using Supabase from Render (important):** If your database is **Supabase**, do **not** use the direct connection (port 5432). Use the **Connection pooler** (port **6543**) or you will often see "Connection terminated due to connection timeout". In Supabase: Project Settings → Database → "Connection string" → choose **"Transaction"** (pooler) and copy the URI. It looks like:
   `postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`
   Set that as **DATABASE_URL** (or **INTERNAL_DATABASE_URL**) on Render so the backend uses the pooler. Leave DB_HOST/DB_PORT unused when using a full URL.

6. **Run Migrations**:
   - Use Render's "Shell" feature to run:
     ```bash
     npm run migration:run
     npm run seed
     ```

#### Render Free Tier Details:
- ✅ **Completely FREE** for web services
- ✅ 750 hours/month (enough for 24/7 operation)
- ⚠️ Sleeps after 15 min inactivity (wakes automatically on request)
- ⚠️ PostgreSQL: 90 days free, then $7/month (use Supabase instead for free forever)
- ⚠️ Redis: 30 days free, then $10/month (use Upstash instead for free forever)

---

### Option B: Railway (FREE with $5 Credit/Month)

**Railway** gives you $5 free credit every month, which is usually enough for small projects.

#### Steps:

1. **Sign up**: Go to [https://railway.app](https://railway.app) and sign up with GitHub
2. **Create New Project**: Click "New Project"
3. **Deploy from GitHub**:
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Select the `backend` folder as the root directory
4. **Add PostgreSQL** (or use Supabase for free forever - recommended):
   - Click "+ New" → "Database" → "Add PostgreSQL"
   - Railway will automatically create a PostgreSQL instance
   - **OR use Supabase PostgreSQL (completely free)** - see Option C below
5. **Add Redis** (or use Upstash for free forever - recommended):
   - Click "+ New" → "Database" → "Add Redis"
   - Railway will automatically create a Redis instance
   - **OR use Upstash Redis (completely free)** - see Option C below
6. **Configure Environment Variables**:
   - Go to your backend service → "Variables"
   - Add the following variables (Railway will auto-populate database URLs if using Railway DBs):

```bash
# Database (from Railway PostgreSQL OR Supabase)
DATABASE_URL=${{Postgres.DATABASE_URL}}
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_USERNAME=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
DB_NAME=${{Postgres.PGDATABASE}}

# Redis (from Railway Redis OR Upstash)
REDIS_URL=${{Redis.REDIS_URL}}
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
REDIS_PASSWORD=${{Redis.REDIS_PASSWORD}}

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRES_IN=3600
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this
JWT_REFRESH_EXPIRES_IN=86400

# Application
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com

# File Storage (Supabase Storage - FREE)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-key
```

7. **Configure Build Settings**:
   - Go to "Settings" → "Build"
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:prod`
   - Root Directory: `backend`

8. **Run Migrations**:
   - After first deployment, go to "Deployments" → Click on the latest deployment
   - Open "View Logs" → Click "Run Command"
   - Run: `npm run migration:run`
   - Then run: `npm run seed` (optional, for initial data)

9. **Get Backend URL**:
   - Railway will provide a URL like: `https://your-app.railway.app`
   - Note this URL for frontend configuration

#### Railway Free Tier Details:
- ✅ **$5 free credit every month** (usually enough for small projects)
- ✅ No credit card required initially
- ⚠️ If you exceed $5, you'll need to add payment method
- 💡 **Tip**: Use Supabase (free) for PostgreSQL and Upstash (free) for Redis to save Railway credits

---

### Option C: FREE Database & Redis Services (Use with Any Backend Platform)

These services are **100% FREE forever** and work with any backend deployment platform.

#### Supabase PostgreSQL (100% FREE Forever)

**Supabase** offers a completely free PostgreSQL database with 500MB storage.

1. **Sign up**: Go to [https://supabase.com](https://supabase.com) and create account (FREE)
2. **Create New Project**:
   - Click "New Project"
   - Choose organization
   - Name: `scaffolding-estimation`
   - Database Password: (save this!)
   - Region: Choose closest to you
   - **Plan: FREE**
3. **Get Connection Details**:
   - Go to Project Settings → Database
   - Copy connection string or individual values:
     - Host: `db.xxxxx.supabase.co`
     - Port: `5432` (direct) or **6543** (pooler — use this for Render/Railway)
     - Database: `postgres`
     - User: `postgres`
     - Password: (the one you set)
   - **For backend on Render/Railway:** use the **Connection pooler** (Transaction mode, port **6543**). The direct connection (5432) often times out from cloud runtimes. In Database settings, open "Connection string" → "URI" and choose the **Transaction** (pooler) tab; use that URL as `DATABASE_URL`.
4. **Use in Backend**:
   - Add these to your backend environment variables
   - Supabase is free forever with 500MB storage

#### Upstash Redis (100% FREE Forever)

**Upstash** offers serverless Redis with a generous free tier.

1. **Sign up**: Go to [https://upstash.com](https://upstash.com) and create account (FREE)
2. **Create Redis Database**:
   - Click "Create Database"
   - Name: `scaffolding-redis`
   - Type: **Regional** (free tier)
   - Region: Choose closest to you
   - **Plan: FREE**
3. **Get Connection Details**:
   - Copy the Redis URL or individual values:
     - Host: `xxxxx.upstash.io`
     - Port: `6379`
     - Password: (provided by Upstash)
4. **Use in Backend**:
   - Add these to your backend environment variables
   - Upstash free tier: 10,000 commands/day (usually enough for small projects)

---

## 3. Frontend Deployment (100% FREE Options)

The frontend is a **Next.js** application. All options below are completely FREE.

---

### Option A: Vercel (Recommended - 100% FREE)

**Vercel** is made by the creators of Next.js and offers the best Next.js experience. **Completely FREE for personal projects.**

#### Steps:

1. **Sign up**: Go to [https://vercel.com](https://vercel.com) and sign up with GitHub (FREE)
2. **Import Project**:
   - Click "Add New..." → "Project"
   - Import your GitHub repository
3. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install`
4. **Environment Variables**:
   - Add the following variables:

```bash
# Backend API URL (from your backend deployment)
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com/api/v1

# Or if using Railway
NEXT_PUBLIC_API_URL=https://your-backend.railway.app/api/v1
```

5. **Deploy**:
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - You'll get a URL like: `https://your-app.vercel.app`

6. **Custom Domain (Optional - FREE)**:
   - Go to "Settings" → "Domains"
   - Add your custom domain (if you have one)
   - Configure DNS records as instructed

#### Vercel Free Tier Details:
- ✅ **Completely FREE** for personal projects
- ✅ Unlimited deployments
- ✅ Automatic HTTPS
- ✅ Custom domains (if you own one)
- ✅ 100GB bandwidth/month (usually enough)

---

### Option B: Netlify (100% FREE)

**Netlify** is another excellent option for Next.js applications. **Completely FREE.**

#### Steps:

1. **Sign up**: Go to [https://www.netlify.com](https://www.netlify.com) and sign up with GitHub (FREE)
2. **Add New Site**:
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repository
3. **Build Settings**:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/.next`
   - **Node version**: 18 or 20
4. **Environment Variables**:
   - Go to "Site settings" → "Environment variables"
   - Add:

```bash
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com/api/v1
```

5. **Deploy**:
   - Netlify will auto-deploy on git push
   - You'll get a URL like: `https://your-app.netlify.app`

#### Netlify Free Tier Details:
- ✅ **Completely FREE**
- ✅ 100GB bandwidth/month
- ✅ 300 build minutes/month
- ✅ Automatic HTTPS
- ✅ Custom domains (if you own one)

---

### Option C: Railway (FREE with $5 Credit/Month)

You can also deploy the frontend on Railway alongside the backend (uses your $5/month credit).

#### Steps:

1. **Add New Service**:
   - In your Railway project, click "+ New"
   - Select "GitHub Repo" → Choose your repository
2. **Configure Service**:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. **Environment Variables**:
   ```bash
   NEXT_PUBLIC_API_URL=https://your-backend-service.railway.app/api/v1
   PORT=3001
   ```
4. **Deploy**:
   - Railway will auto-deploy

#### Railway Free Tier Details:
- ✅ Uses your $5/month free credit
- ⚠️ If deploying both backend and frontend, you might need to be careful with credit usage
- 💡 **Recommendation**: Use Vercel for frontend (free) and Railway for backend to save credits

---

## 4. Post-Deployment Configuration

### Step 1: Update Frontend API URL

After deploying the backend, update the frontend's `NEXT_PUBLIC_API_URL` environment variable to point to your deployed backend.

### Step 2: Configure CORS

Ensure your backend allows requests from your frontend domain. In your backend code, verify CORS settings:

```typescript
// backend/src/main.ts
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
});
```

### Step 3: Run Database Migrations

After backend deployment, run migrations:

```bash
# On Railway: Use "Run Command" in deployment logs
npm run migration:run

# On Render: Use Shell feature
npm run migration:run

# Optional: Seed initial data
npm run seed
```

### Step 4: Verify Deployment

1. **Backend Health Check**:
   - Visit: `https://your-backend-url.com/health` (if configured)
   - Or: `https://your-backend-url.com/api/v1/` (should return API info)

2. **Frontend**:
   - Visit your frontend URL
   - Try logging in with default credentials:
     - Email: `admin@example.com`
     - Password: `admin123`

### Step 5: Set Up Custom Domains (Optional - FREE if you own a domain)

If you own a domain name, you can use it for free on all platforms.

#### Backend Custom Domain:
1. **Render**: Go to Settings → Custom Domains → Add domain (FREE)
2. **Railway**: Go to Settings → Domains → Add custom domain (FREE)
3. Update DNS records as instructed (usually just add a CNAME record)

#### Frontend Custom Domain:
1. **Vercel**: Settings → Domains → Add domain (FREE)
2. **Netlify**: Site settings → Domain management → Add custom domain (FREE)
3. Update DNS records (usually just add a CNAME record)

**Note**: You need to own/purchase a domain name first (from services like Namecheap, Google Domains, etc. - typically $10-15/year). The platform itself doesn't charge for using your custom domain.

---

## 5. Troubleshooting

### Backend Issues

#### Build Fails
- **Check logs**: Review deployment logs for errors
- **Node version**: Ensure platform supports Node.js 18+
- **Dependencies**: Verify all dependencies are in `package.json`

#### Database Connection Fails
- **Check credentials**: Verify environment variables are correct
- **Network**: Ensure database allows connections from deployment platform
- **SSL**: Some platforms require SSL connections (add `?sslmode=require` to connection string)
- **"Connection terminated due to connection timeout" (Render + Supabase)**: Use Supabase’s **connection pooler** (port **6543**), not the direct connection (5432). Set **DATABASE_URL** to the pooler URI from Supabase → Project Settings → Database → Connection string → **Transaction** (pooler). See the Render environment variables section above.

#### Redis Connection Fails
- **Check URL**: Verify Redis connection string format
- **Network**: Ensure Redis allows connections from deployment platform

### Frontend Issues

#### Build Fails
- **Check logs**: Review build logs
- **API URL**: Ensure `NEXT_PUBLIC_API_URL` is set correctly
- **Dependencies**: Verify all dependencies are installed

#### API Calls Fail
- **CORS**: Check backend CORS settings allow frontend domain
- **API URL**: Verify `NEXT_PUBLIC_API_URL` points to correct backend
- **Network**: Check browser console for errors

#### Environment Variables Not Working
- **Prefix**: Next.js requires `NEXT_PUBLIC_` prefix for client-side variables
- **Rebuild**: Redeploy after changing environment variables

### General Issues

#### Environment Variables Not Loading
- **Restart**: Redeploy after adding/changing environment variables
- **Format**: Ensure no extra spaces or quotes in variable values
- **Secrets**: Some platforms have separate "Secrets" section

#### Database Migrations Fail
- **Permissions**: Ensure database user has migration permissions
- **Connection**: Verify database is accessible
- **Manual**: Run migrations manually via platform's shell/command feature

---

## Quick Reference: Deployment URLs (FREE)

After deployment, you should have:

- **Backend**: `https://your-backend.onrender.com` (Render - FREE) or `https://your-backend.railway.app` (Railway - FREE with credit)
- **Frontend**: `https://your-frontend.vercel.app` (Vercel - FREE) or `https://your-frontend.netlify.app` (Netlify - FREE)
- **Database**: `db.xxxxx.supabase.co` (Supabase - FREE)
- **Redis**: `xxxxx.upstash.io` (Upstash - FREE)

---

## Recommended Setup (100% FREE Forever)

### Best FREE Combination:

1. **Backend**: Render (completely free, sleeps after inactivity but wakes automatically)
2. **Frontend**: Vercel (completely free, unlimited personal projects)
3. **Database**: Supabase PostgreSQL (completely free, 500MB storage)
4. **Redis**: Upstash (completely free, 10,000 commands/day)
5. **File Storage**: Supabase Storage (completely free, 1GB storage)

### Complete FREE Setup Cost:
- ✅ Backend (Render): **$0/month** (750 hours/month, sleeps after 15 min)
- ✅ Frontend (Vercel): **$0/month** (unlimited personal projects)
- ✅ Database (Supabase): **$0/month** (500MB storage, free forever)
- ✅ Redis (Upstash): **$0/month** (10,000 commands/day, free forever)
- ✅ File Storage (Supabase): **$0/month** (1GB storage, free forever)
- **🎉 TOTAL: $0/month - Completely FREE!**

### Alternative FREE Setup (If Render Sleep Time is an Issue):

1. **Backend**: Railway ($5 credit/month - usually enough)
2. **Frontend**: Vercel (free)
3. **Database**: Supabase (free)
4. **Redis**: Upstash (free)
5. **File Storage**: Supabase Storage (free)

**Cost**: $0/month (as long as you stay within $5 Railway credit)

### Important Notes:

- **Render sleep time**: Your backend will sleep after 15 minutes of inactivity. The first request after sleep takes ~30 seconds to wake up, then it's fast. This is fine for most projects.
- **Supabase limits**: 500MB database and 1GB file storage should be enough for small to medium projects.
- **Upstash limits**: 10,000 Redis commands/day is usually enough unless you have very high traffic.
- **All services are free forever** - no credit card required!

---

## Next Steps (100% FREE)

1. ✅ Create GitHub repository
2. ✅ Set up Supabase PostgreSQL (free)
3. ✅ Set up Upstash Redis (free)
4. ✅ Deploy backend to Render (free)
5. ✅ Deploy frontend to Vercel (free)
6. ✅ Configure environment variables
7. ✅ Run database migrations
8. ✅ Test the application
9. ✅ Set up custom domains (optional, if you own a domain)
10. ✅ Enjoy your completely FREE deployment! 🎉

**Remember**: All services are free forever, but some have usage limits. Monitor your usage to ensure you stay within free tiers.

---

## Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Vercel Documentation](https://vercel.com/docs)
- [Render Documentation](https://render.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [NestJS Deployment](https://docs.nestjs.com/recipes/deployment)

---

**Last Updated**: 2024
**Project**: Scaffolding Estimation Platform
