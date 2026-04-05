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

# ============================================
# Email — Brevo / SendGrid HTTP API (recommended on Render) OR SMTP
# ============================================
# On Render and many PaaS hosts, outbound SMTP (port 587/465) often times out or is blocked.
# Use HTTPS transactional APIs instead of smtp-relay.brevo.com when deploying in the cloud.
#
# Brevo over HTTPS (preferred on Render — same account as Brevo SMTP, different key type):
# BREVO_API_KEY=xkeysib-xxx   # Brevo → Transactional → API keys (not the SMTP password)
# (Legacy alias: SENDINBLUE_API_KEY — same value as BREVO_API_KEY if you already use that name.)
# SMTP_FROM="App <verified@yourdomain.com>"
#
# Brevo SMTP relay (OK on your own server/VPS; may fail on Render with “Connection timeout”):
# SMTP_HOST=smtp-relay.brevo.com
# SMTP_PORT=587
# SMTP_USER=your_smtp_login
# SMTP_PASS=your_smtp_key
# SMTP_SECURE=false          # default; use STARTTLS on 587 (omit or false)
# SMTP_FROM="App <verified@yourdomain.com>"   # recommended; if omitted, From = SMTP_USER
#
# If BREVO_API_KEY or SENDGRID_API_KEY is set, the app never opens an SMTP connection (HTTPS only).
# On boot, logs show either "Brevo HTTPS API" or "SMTP to …" so you can confirm what Render is using.
#
# SendGrid (HTTPS, avoids SMTP timeouts on some PaaS):
# SENDGRID_API_KEY=SG.xxx   (API key with Mail Send; same key as SMTP “password”)
# SMTP_FROM=verified@yourdomain.com   (required with API; your verified sender)
#
# Other SMTP providers:
# Apply supabase-migrations/118_password_reset_tokens.sql (or TypeORM migration
# 1700000000006) for the password_reset_tokens table + get_user_id_by_email_ci.
#
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=your-smtp-user
# SMTP_PASS=your-smtp-password
# SMTP_FROM="Scaffold App <noreply@example.com>"
# If SMTP times out on your host (e.g. Render → SendGrid), the app prefers IPv4 by default.
# To force IPv6 instead: SMTP_USE_IPV6=true
# Alternative: SendGrid port 465 + SMTP_SECURE=true

# File Upload Limits
MAX_FILE_SIZE=524288000
ALLOWED_FILE_TYPES=pdf,dxf,dwg

# ============================================
# BILLING: MANUAL BANK TRANSFER (optional)
# ============================================
# When set, /billing shows 銀行振込 details after login. Users should put their
# registered email in the transfer memo; you confirm at the bank and set access
# in Superadmin → Subscribers if not using Stripe alone.
# BANK_TRANSFER_ENABLED=true
# BANK_TRANSFER_BANK_NAME=みずほ銀行
# BANK_TRANSFER_BRANCH=〇〇支店
# BANK_TRANSFER_ACCOUNT_TYPE=普通
# BANK_TRANSFER_ACCOUNT_NUMBER=1234567
# BANK_TRANSFER_ACCOUNT_HOLDER=カ）サンプル
# BANK_TRANSFER_AMOUNT_NOTE=月額 〇〇円（例）
# Optional English (shown to en/fr users, or under Japanese for ja):
# BANK_TRANSFER_BANK_NAME_EN=Sumitomo Mitsui Banking Corporation
# BANK_TRANSFER_BRANCH_EN=Fussa Branch (branch code 697)
# BANK_TRANSFER_ACCOUNT_TYPE_EN=Ordinary deposit
# BANK_TRANSFER_ACCOUNT_HOLDER_EN=SOU ALPHA OMAR
# BANK_TRANSFER_AMOUNT_NOTE_EN=Bank code 0009
# Optional French UI (fr locale):
# BANK_TRANSFER_BANK_NAME_FR=Banque Sumitomo Mitsui
# BANK_TRANSFER_BRANCH_FR=Agence de Fussa (code guichet 697)
# BANK_TRANSFER_ACCOUNT_TYPE_FR=Compte courant
# BANK_TRANSFER_ACCOUNT_HOLDER_FR=SOU ALPHA OMAR
# BANK_TRANSFER_AMOUNT_NOTE_FR=Code banque 0009
#
# If production API is not redeployed yet, you can set the same fields on the
# frontend host as NEXT_PUBLIC_BANK_TRANSFER_* (see frontend/.env.example) and
# redeploy the Next.js app; /billing will show 銀行振込 from the client env.

# ============================================
# STRIPE (optional — card checkout + webhooks)
# ============================================
# Use either STRIPE_SECRET_KEY (full secret) or STRIPE_RESTRICTED_KEY if your host
# only allows restricted keys. Checkout needs permission to create sessions; the
# webhook handler may need a key with broader permissions if the restricted key
# cannot read subscription events — test in Stripe test mode first.
#
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_RESTRICTED_KEY=rk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
#
# Multi-plan: recurring price_... per tier (e.g. yearly updates). Required for each tier you sell.
# STRIPE_PRICE_ID_BASIC=price_...
# STRIPE_PRICE_ID_MEDIUM=price_...
# STRIPE_PRICE_ID_PREMIUM=price_...
#
# Optional one-time price per tier (e.g. license) — charged once on the first Checkout
# invoice together with the recurring line. Omit if you only charge yearly.
# STRIPE_PRICE_ID_BASIC_ONETIME=price_...
# STRIPE_PRICE_ID_MEDIUM_ONETIME=price_...
# STRIPE_PRICE_ID_PREMIUM_ONETIME=price_...
#
# Legacy single price (still supported): if none of the three above are set,
# STRIPE_PRICE_ID=price_... is used as tier "standard". Optional one-time for that path:
# STRIPE_PRICE_ID_ONETIME=price_...
# STRIPE_PRICE_ID=price_...

# ============================================
# FREE TRIAL RESTART (self-service, gated)
# ============================================
# POST /api/v1/subscriptions/me/restart-fresh-trial (JWT) resets trial to a fresh
# window from now (same TRIAL_DAYS as signup, e.g. 7) and clears trial document count.
# Allowed only if EITHER:
#   (1) NODE_ENV=development AND ALLOW_DEV_TRIAL_RESTART=true
#       → Billing page on localhost shows a "Start fresh 7-day trial" button.
#   (2) TRIAL_RESTART_SECRET is set → client sends header x-trial-restart-secret: <same>
# Superadmins can also POST .../subscriptions/admin/:userId/restart-fresh-trial (no secret).
#
# ALLOW_DEV_TRIAL_RESTART=true
# TRIAL_RESTART_SECRET=openssl-rand-hex-or-similar
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
