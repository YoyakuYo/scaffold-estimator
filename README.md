# 仮設材積算システム — Scaffold Material Estimation System

A professional deterministic scaffold quantity calculation engine for Japanese construction companies.

## Features

- **Two Input Modes**: Drawing upload (manual editor) and Quick Shape Builder
- **Scaffold Types**: Kusabi (くさび式足場) and Wakugumi (枠組足場)
- **Per-Side Calculation**: Materials calculated per side, totals derived from side sums
- **2D/3D Assembly Views**: Visual scaffold representation with export support
- **Quotation System**: Material cost estimation with Excel/PDF export
- **Deterministic Engine**: Same input always produces the same output

## Architecture

- **Frontend**: Next.js (React) with Tailwind CSS
- **Backend**: NestJS with PostgreSQL (TypeORM)
- **Calculation Engine**: Deterministic scaffold material calculation
- **No AI dependencies**: All calculations are rule-based and deterministic

## Quick Start

```bash
# Backend
cd backend
npm install
npm run start:dev

# Frontend
cd frontend
npm install
npm run dev
```

### Claude Code (optional)

From the project root you can run [Claude Code](https://code.claude.com/docs) for terminal-based coding assistance:

```bash
npm run claude
# or: npx claude
```

On Windows (without editing PATH), you can also run the repo-local launchers:

```powershell
.\claude.ps1
# or (cmd)
.\claude.cmd
```
