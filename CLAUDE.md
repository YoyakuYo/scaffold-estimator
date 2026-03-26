---
description: 
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

仮設材積算システム — a deterministic scaffold material quantity estimation system for Japanese construction companies. Supports two scaffold types: **くさび式 (kusabi)** and **枠組 (wakugumi)**. Calculations are rule-based and deterministic (same input → same output), with no AI in the calculation path. AI (Claude via Anthropic SDK) is used only in the `vision-bim` module for plan image/PDF analysis. IFC/BIM files are NOT supported. Accepted file types: images (PNG/JPEG/WebP/GIF/BMP), PDF, and DXF only.

## Architecture

Monorepo with two independent apps:

- **`frontend/`** — Next.js 16 (React 18), Tailwind CSS, runs on port 3001
- **`backend/`** — NestJS 10, TypeORM, PostgreSQL (Supabase), Redis (optional), runs on port 3000

### Frontend Structure

- `app/` — Next.js App Router pages (route segments map to features: estimates, quotations, scaffold, admin, etc.)
- `components/` — Shared UI components
- `scaffolding/` — **Core calculation engine** (pure TypeScript, no dependencies). `scaffoldEngine.ts` is the main entry point; `kusabiCalculator.ts` handles kusabi-specific logic.
- `lib/api/` — Axios API client modules, one file per backend resource (e.g. `estimates.ts`, `drawings.ts`). Auth token is injected from the `access_token` cookie in `client.ts`.
- `lib/i18n/` — Japanese/English translations via `useI18n()` hook
- `lib/ai-bim-rules.ts` — Rules for AI BIM plan extraction

### Backend Structure

- `src/modules/` — One NestJS module per domain: `auth`, `drawing`, `estimate`, `cost`, `export`, `quotation`, `rental`, `scaffold-config`, `subscription`, `company`, `vision-bim`, `mailer`, `messaging`, `notifications`, `supabase`
- `src/common/` — Shared guards, filters, interceptors
- `src/database/` — TypeORM data source, migrations, seeds
- All routes are prefixed with `/api/v1`
- Auth: JWT Bearer tokens; Supabase for file storage

### Key Design Decisions

- The scaffold calculation engine lives entirely in the **frontend** (`frontend/scaffolding/`), not the backend — calculations run client-side without a network call.
- Redis is **optional**: the app degrades gracefully if Redis is unavailable (background job processing disabled; all other features work).
- CORS is open (`origin: true`) because auth is JWT-based, not cookie/session-based.
- Body parser limit is 50 MB to support large SVG/base64 payloads for PDF exports.

## Development Commands

### Backend

```bash
cd backend
npm install
npm run start:dev          # Watch mode (development)
npm run build              # Compile TypeScript
npm run start              # Run compiled dist
npm run test               # Run Jest unit tests
npm run test:watch         # Jest in watch mode
npm run test:cov           # Jest with coverage
npm run test:e2e           # E2E tests
npm run lint               # ESLint with auto-fix
npm run format             # Prettier
npm run migration:generate # Generate TypeORM migration
npm run migration:run      # Apply migrations
npm run seed               # Run database seeds
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # Dev server on port 3001 (webpack mode)
npm run build              # Production build
npm run lint               # ESLint
npm run type-check         # TypeScript check without emit
```

### Local Infrastructure (Docker)

```bash
docker compose up -d       # Start PostgreSQL (5432) and Redis (6379)
```

## Environment Setup

Create `backend/.env` from `backend/ENV_SETUP.md`. Key variables:

```
DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_NAME  # PostgreSQL (Supabase)
JWT_SECRET / JWT_REFRESH_SECRET
SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
REDIS_HOST / REDIS_PORT / REDIS_PASSWORD   # Optional; defaults to localhost:6379
PORT=3000
FRONTEND_URL=http://localhost:3001
ANTHROPIC_API_KEY   # Required for vision-bim AI plan analysis
```

Frontend env (optional, in `frontend/.env.local`):

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000/api/v1
```

If `NEXT_PUBLIC_BACKEND_URL` is unset, dev defaults to `http://localhost:3000/api/v1`.

## Running a Single Test

```bash
cd backend
npx jest src/modules/estimate/estimate.service.spec.ts
npx jest --testNamePattern="should calculate"
```
