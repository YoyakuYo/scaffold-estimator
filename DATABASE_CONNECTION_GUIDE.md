# Database Connection Guide - Understanding .env Database Settings

## What Are These Values?

These are the connection credentials your **NestJS backend** needs to connect to your **Supabase PostgreSQL database**.

```
DB_HOST=db.xxxxx.supabase.co      ← Where is the database server?
DB_PORT=5432                       ← Which port to connect on?
DB_USERNAME=postgres              ← What username to use?
DB_PASSWORD=your-password         ← What password to authenticate?
DB_NAME=postgres                  ← Which database to connect to?
```

---

## Why Do You Need Them in .env?

Your NestJS backend application needs to **connect to the database** to:
- ✅ Read/write data (users, drawings, estimates, costs)
- ✅ Run database queries
- ✅ Execute migrations
- ✅ Store and retrieve all application data

**Without these credentials, your backend cannot access the database at all.**

Look at `backend/src/app.module.ts` - it uses these values to configure TypeORM:

```typescript
TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    type: 'postgres',
    host: configService.get('DB_HOST'),      // ← Reads from .env
    port: configService.get('DB_PORT'),      // ← Reads from .env
    username: configService.get('DB_USERNAME'), // ← Reads from .env
    password: configService.get('DB_PASSWORD'), // ← Reads from .env
    database: configService.get('DB_NAME'),     // ← Reads from .env
    // ... rest of config
  }),
})
```

---

## Where to Find These Values in Supabase

### Step 1: Go to Supabase Dashboard
1. Open your Supabase project
2. Click **⚙️ Settings** (gear icon in left sidebar)
3. Click **Database** in the settings menu

### Step 2: Find Connection Info

You'll see a section called **"Connection string"** or **"Connection pooling"**. Here's what each value is:

#### **DB_HOST** (Database Host)
- **What it is**: The server address where your database lives
- **Format**: `db.XXXXX.supabase.co` (where XXXXX is your project reference)
- **Where to find**: Look for "Host" in the connection string
- **Example**: `db.abcdefghijklmnop.supabase.co`

#### **DB_PORT** (Port Number)
- **What it is**: The network port PostgreSQL listens on
- **Value**: Usually `5432` (standard PostgreSQL port)
- **Where to find**: In the connection string after the host
- **Note**: If using connection pooler, it might be `6543`

#### **DB_USERNAME** (Database Username)
- **What it is**: The database user account name
- **Value**: Almost always `postgres` (default PostgreSQL superuser)
- **Where to find**: In the connection string, usually `postgres@...`

#### **DB_PASSWORD** (Database Password)
- **What it is**: The password you set when creating the Supabase project
- **Where to find**: 
  - You set this when you **first created** your Supabase project
  - If you forgot it: Supabase Dashboard → Settings → Database → "Reset database password"
- **⚠️ Important**: This is different from your Supabase account password!

#### **DB_NAME** (Database Name)
- **What it is**: The name of the specific database
- **Value**: Usually `postgres` (default database in Supabase)
- **Where to find**: In the connection string, usually at the end

---

## Example Connection String Breakdown

Supabase might show you a connection string like this:

```
postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnop.supabase.co:5432/postgres
```

Breaking it down:
- **Protocol**: `postgresql://`
- **Username**: `postgres` → `DB_USERNAME`
- **Password**: `[YOUR-PASSWORD]` → `DB_PASSWORD`
- **Host**: `db.abcdefghijklmnop.supabase.co` → `DB_HOST`
- **Port**: `5432` → `DB_PORT`
- **Database**: `postgres` → `DB_NAME`

---

## Your .env File Should Look Like:

```env
# Database (Supabase)
DB_HOST=db.abcdefghijklmnop.supabase.co
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-actual-database-password-here
DB_NAME=postgres
```

---

## Quick Steps to Fill In Your .env

1. **Go to Supabase Dashboard** → Settings → Database
2. **Find "Connection string"** section
3. **Copy the values**:
   - Host: `db.XXXXX.supabase.co` → paste as `DB_HOST`
   - Port: `5432` (or `6543` if using pooler) → paste as `DB_PORT`
   - Username: `postgres` → paste as `DB_USERNAME`
   - Database: `postgres` → paste as `DB_NAME`
   - Password: Use the password you set when creating the project → paste as `DB_PASSWORD`

4. **If you forgot the password**: Click "Reset database password" in Supabase Dashboard

---

## Why Not Use Supabase API Keys Instead?

**Supabase API Keys** (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are for:
- ✅ Supabase Auth (authentication)
- ✅ Supabase Storage (file uploads)
- ✅ Supabase Realtime (real-time subscriptions)
- ✅ Direct client-side access via Supabase JS client

**Database credentials** (`DB_HOST`, `DB_PORT`, etc.) are for:
- ✅ Direct PostgreSQL connection (what NestJS/TypeORM needs)
- ✅ Running SQL queries directly
- ✅ Database migrations
- ✅ Backend-to-database communication

Your NestJS backend uses **TypeORM**, which needs a **direct PostgreSQL connection**, not the Supabase REST API. That's why you need both:
- Database credentials (for TypeORM/PostgreSQL connection)
- API keys (for Supabase services like Storage)

---

## Security Note

⚠️ **Never commit `.env` to Git!** It contains sensitive credentials.

The `.env` file is already in `.gitignore` to prevent accidental commits.
