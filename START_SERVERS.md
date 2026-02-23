# How to Start the Platform - Step by Step

## Prerequisites Check

1. ✅ Supabase database is set up and running
2. ✅ `.env` file is configured in `backend/` directory
3. ✅ Node.js and npm are installed (you have v22.20.0)

---

## Step 1: Fix Frontend Package (if needed)

If you haven't already, fix the `dxf-parser` version in `frontend/package.json`:

```bash
# The version should be "^1.1.2" not "^1.4.4"
# This should already be fixed, but verify if installation fails
```

---

## Step 2: Install Dependencies

### Backend Dependencies
```bash
cd backend
npm install
```

### Frontend Dependencies
```bash
cd frontend
npm install
```

**Note**: If you get errors about `dxf-parser`, the package.json should already be fixed. If not, let me know and I'll fix it.

---

## Step 3: Start Backend Server

Open **Terminal 1** (or PowerShell window 1):

```bash
cd backend
npm run start:dev
```

You should see:
```
[Nest] Starting Nest application...
Application is running on: http://localhost:3000
```

**Keep this terminal open!** The backend must stay running.

---

## Step 4: Start Frontend Server

Open **Terminal 2** (or a NEW PowerShell window):

```bash
cd frontend
npm run dev
```

You should see:
```
▲ Next.js 14.1.0
- Local:        http://localhost:3001
- Ready in X seconds
```

**Keep this terminal open too!**

---

## Step 5: Open the Platform

Open your browser and go to:

**http://localhost:3001**

You should see the scaffolding estimation platform!

---

## Quick Commands Summary

### Terminal 1 (Backend):
```bash
cd "C:\Users\81704\Desktop\zoomen reader\backend"
npm run start:dev
```

### Terminal 2 (Frontend):
```bash
cd "C:\Users\81704\Desktop\zoomen reader\frontend"
npm run dev
```

---

## Troubleshooting

### Backend won't start?

1. **Check .env file exists** in `backend/` directory
2. **Verify database credentials** are correct in `.env`
3. **Check if port 3000 is already in use**:
   ```bash
   netstat -ano | findstr :3000
   ```

### Frontend won't start?

1. **Check if port 3001 is already in use**:
   ```bash
   netstat -ano | findstr :3001
   ```
2. **Try clearing Next.js cache**:
   ```bash
   cd frontend
   rm -rf .next
   npm run dev
   ```

### "Cannot connect to database" error?

- Verify your Supabase database credentials in `backend/.env`
- Make sure your Supabase project is active
- Check that the database password is correct

### "Redis connection failed" error?

- If using local Redis: Start it with `docker-compose up -d redis` (if Docker is installed)
- If not using Docker: The app should still work, but background jobs (CAD parsing) won't run
- For now, you can ignore Redis errors if you're just testing the UI

---

## What You'll See

Once both servers are running:

1. **Backend API**: Running on `http://localhost:3000`
   - API endpoints: `http://localhost:3000/api/v1/...`
   - Health check: `http://localhost:3000/api/v1/health` (if implemented)

2. **Frontend App**: Running on `http://localhost:3001`
   - Login page
   - Dashboard
   - Drawing upload
   - Estimate creation
   - Cost breakdown editor

---

## Default Login Credentials

Use these to log in (from the seed data):

- **Email**: `admin@example.com`
- **Password**: `admin123`

OR

- **Email**: `estimator@example.com`
- **Password**: `estimator123`

---

## Stopping the Servers

To stop the servers:
1. Go to each terminal window
2. Press `Ctrl + C`
3. Confirm with `Y` if prompted

---

## Next Steps After Starting

1. ✅ Log in with admin credentials
2. ✅ Upload a drawing (PDF/DXF/DWG)
3. ✅ Create an estimate
4. ✅ View cost breakdown
5. ✅ Export to PDF/Excel

Enjoy your scaffolding estimation platform! 🚀
