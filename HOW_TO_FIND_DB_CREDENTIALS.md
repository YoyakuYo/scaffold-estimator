# How to Find Database Credentials in Supabase Dashboard

## Step-by-Step Guide

### Step 1: Open Supabase Dashboard
1. Go to [https://supabase.com](https://supabase.com)
2. Log in to your account
3. Select your project (the one you created)

### Step 2: Navigate to Database Settings
1. In the **left sidebar**, look for **⚙️ Settings** (gear icon)
2. Click on **Settings**
3. In the settings menu, click on **"Database"** (not "API")

### Step 3: Find Connection Info

You should see a section called **"Connection string"** or **"Connection pooling"**. Here's what to look for:

#### Option A: Connection String (URI)
Look for a section that shows something like:
```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```

#### Option B: Connection Parameters
You might see individual fields:
- **Host**: `db.xxxxx.supabase.co`
- **Port**: `5432`
- **Database name**: `postgres`
- **User**: `postgres`
- **Password**: (hidden, but you can reset it)

### Step 4: Extract the Values

From the connection string, extract:
- **DB_HOST**: The part after `@` and before `:5432` (e.g., `db.xxxxx.supabase.co`)
- **DB_PORT**: Usually `5432`
- **DB_USERNAME**: Usually `postgres`
- **DB_NAME**: Usually `postgres` (at the end of the connection string)
- **DB_PASSWORD**: The password you set when creating the project

---

## Alternative: If You Can't Find It

### Method 1: Check Connection Pooling Section
1. In **Settings → Database**
2. Look for **"Connection pooling"** tab
3. You'll see connection strings there too

### Method 2: Use Connection String from API Settings
1. Go to **Settings → API**
2. Look for **"Project URL"** - this gives you the format
3. For database host, add `db.` prefix to your project reference
4. Example: If Project URL is `https://abcdefgh.supabase.co`
   - Then DB_HOST is `db.abcdefgh.supabase.co`

### Method 3: Reset Database Password
If you forgot your password:
1. Go to **Settings → Database**
2. Scroll down to **"Database password"** section
3. Click **"Reset database password"**
4. Copy the new password immediately (you won't see it again!)

---

## Visual Guide (What You Should See)

In Supabase Dashboard → Settings → Database, you should see:

```
┌─────────────────────────────────────────┐
│  Database Settings                      │
├─────────────────────────────────────────┤
│                                         │
│  Connection string                      │
│  ┌───────────────────────────────────┐  │
│  │ postgresql://postgres:***@       │  │
│  │ db.xxxxx.supabase.co:5432/postgres│  │
│  └───────────────────────────────────┘  │
│                                         │
│  Connection pooling                     │
│  ┌───────────────────────────────────┐  │
│  │ postgresql://postgres:***@       │  │
│  │ db.xxxxx.supabase.co:6543/postgres│  │
│  └───────────────────────────────────┘  │
│                                         │
│  Database password                      │
│  [Reset database password]              │
│                                         │
└─────────────────────────────────────────┘
```

---

## Quick Copy-Paste Method

1. In **Settings → Database**, find the connection string
2. Click the **copy icon** next to it
3. It will copy something like:
   ```
   postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres
   ```
4. Break it down:
   - `postgres` (before `:`) = DB_USERNAME
   - `YOUR_PASSWORD` (after first `:`) = DB_PASSWORD
   - `db.xxxxx.supabase.co` (after `@`) = DB_HOST
   - `5432` (after `:`) = DB_PORT
   - `postgres` (after last `/`) = DB_NAME

---

## Still Can't Find It?

If the Supabase UI has changed or you're looking at a different interface:

1. **Check the URL**: Make sure you're on `app.supabase.com` (not a third-party tool)
2. **Try the API tab**: Sometimes connection info is also in Settings → API
3. **Check project settings**: Look for "Connection info" or "Database connection"
4. **Contact support**: If nothing works, Supabase support can help

---

## Your .env Should Look Like:

After finding the values:

```env
DB_HOST=db.xxxxx.supabase.co
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-actual-password-here
DB_NAME=postgres
```

Replace `xxxxx` with your actual project reference and `your-actual-password-here` with your database password.
