# Scaffolding Estimation Platform - Backend

Production-grade scaffolding estimation platform backend for Japanese construction companies.

## Features

- **CAD Drawing Upload**: Support for PDF, DXF, and DWG files with automatic parsing
- **Structure-Specific Calculations**: Strategy pattern for 改修工事, S造, and RC造
- **Cost Breakdown Engine**: Transparent formula-based cost calculations
- **Rental Period Management**: Weekly, monthly, and custom rental periods
- **Japanese Estimate Export**: PDF and Excel generation with proper Japanese formatting

## Tech Stack

- NestJS (Node.js + TypeScript)
- PostgreSQL with TypeORM
- Bull (Redis-backed job queue)
- Puppeteer (PDF generation)
- ExcelJS (Excel generation)
- AWS S3 (File storage)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your database and AWS credentials
```

3. Run database migrations:
```bash
npm run migration:run
```

4. Start the development server:
```bash
npm run start:dev
```

## Database: Supabase vs Render

### Supabase (your case)

You **don’t** need to change to Render Postgres. Keep using Supabase.

To fix **"Connection terminated due to connection timeout"** with Supabase:

1. In **Supabase Dashboard** → your project → **Project Settings** (gear) → **Database**.
2. Under **Connection string**, choose **URI** and **Transaction** (or **Session**) mode.
3. Copy the URL. It should use **port 6543** (pooler), not 5432 (direct).
   - Example: `postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`
4. Set that as **`DATABASE_URL`** in your backend env (e.g. on Render: Web Service → Environment).  
   Use your real DB password (not the placeholder in the dashboard).
5. Redeploy the backend.

Using the **pooler** (port 6543) avoids timeouts; the direct connection (5432) is more likely to drop or timeout.

### Render Postgres (if you used Render’s Postgres instead)

If the backend runs on Render and the DB is **Render Postgres** (not Supabase), set **`INTERNAL_DATABASE_URL`** on the Web Service to the internal URL from the Postgres service’s **Info** tab, then redeploy.

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login

### Drawings
- `POST /api/v1/drawings/upload` - Upload CAD drawing
- `GET /api/v1/drawings` - List drawings
- `GET /api/v1/drawings/:id` - Get drawing details

### Estimates
- `POST /api/v1/estimates` - Create estimate
- `GET /api/v1/estimates/:id` - Get estimate
- `PATCH /api/v1/estimates/:id/bom` - Update bill of materials

### Costs
- `POST /api/v1/costs/estimates/:estimateId/calculate` - Calculate costs
- `GET /api/v1/costs/estimates/:estimateId` - Get cost breakdown
- `GET /api/v1/costs/master-data` - Get cost master data (admin only)

### Exports
- `POST /api/v1/exports/estimates/:estimateId?format=pdf|excel` - Generate export
- `GET /api/v1/exports/:exportId` - Download export

## Project Structure

```
backend/
├── src/
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root module
│   ├── modules/
│   │   ├── auth/                  # Authentication & authorization
│   │   ├── drawing/               # CAD upload & parsing
│   │   ├── estimate/              # Quantity calculation
│   │   ├── cost/                  # Cost breakdown engine
│   │   ├── rental/                # Rental period management
│   │   └── export/                # PDF/Excel generation
│   ├── common/                    # Shared utilities
│   └── database/                  # Migrations
└── package.json
```

## Database Schema

Key entities:
- `drawings` - Uploaded CAD files with normalized geometry
- `estimates` - Estimate records with BOM and cost breakdown
- `cost_line_items` - Individual cost line items with formulas
- `cost_master_data` - Admin-editable cost rates
- `estimate_exports` - Generated PDF/Excel files

## License

UNLICENSED
