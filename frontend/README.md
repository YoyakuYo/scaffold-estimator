# Scaffolding Estimation Platform - Frontend

Next.js 14 frontend application for the scaffolding estimation platform.

## Features

- ✅ Drawing upload with drag & drop
- ✅ CAD viewer (PDF support)
- ✅ Estimate preview and management
- ✅ Cost breakdown editor with real-time updates
- ✅ PDF/Excel export functionality
- ✅ Japanese language support
- ✅ Responsive design

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **TanStack Query** - Server state management
- **Zustand** - Client state management (ready for use)
- **Tailwind CSS** - Styling
- **React PDF** - PDF viewing
- **React Hook Form** - Form handling

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env.local` file:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

## Project Structure

```
frontend/
├── app/                    # Next.js App Router
│   ├── login/             # Login page
│   ├── dashboard/         # Main dashboard
│   ├── estimates/         # Estimate pages
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── drawing-uploader.tsx
│   ├── estimate-preview.tsx
│   ├── cost-breakdown-editor.tsx
│   └── cad-viewer.tsx
├── lib/                   # Utilities
│   ├── api/              # API client functions
│   └── formatters.ts    # Japanese formatting
└── package.json
```

## API Integration

All API calls are handled through the `lib/api/` directory:

- `auth.ts` - Authentication
- `drawings.ts` - Drawing upload and management
- `estimates.ts` - Estimate CRUD operations
- `costs.ts` - Cost calculation
- `exports.ts` - PDF/Excel export

## Components

### DrawingUploader
File upload component with drag & drop support for PDF, DXF, DWG files.

### CADViewer
PDF viewer component with zoom, rotation, and page navigation.

### EstimatePreview
Displays estimate details including BOM and cost breakdown.

### CostBreakdownEditor
Allows editing of cost line items with manual overrides.

## Development

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

### Build

```bash
npm run build
```

## Production Deployment

1. Set `NEXT_PUBLIC_BACKEND_URL` (or `NEXT_PUBLIC_API_URL`) to your backend API base URL, e.g. `https://YOUR-APP.onrender.com/api/v1` if the backend runs on Render. **If this is wrong or unset, login will fail with "Cannot reach the server".**
2. Build the application: `npm run build`
3. Start production server: `npm start`

Or deploy to Vercel/Netlify; set the env var in the dashboard and redeploy so the frontend calls your Render backend.
