# Redis Password Setup Guide

## Quick Answer

**For local development**: Redis password can be **empty** (leave it blank)

**For production**: You'll need credentials from a Redis service like Upstash or Redis Cloud

---

## Local Development (Docker)

If you're using `docker-compose.yml` to run Redis locally:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # ← Leave empty (no password needed)
```

The Redis container in `docker-compose.yml` doesn't require authentication by default.

### To Start Redis Locally:

```bash
# From project root
docker-compose up -d redis
```

This starts Redis on `localhost:6379` without a password.

---

## Production (Cloud Redis Services)

For production, you'll need a managed Redis service. Here are the options:

### Option 1: Upstash (Recommended - Free Tier Available)

1. **Sign up**: Go to [https://upstash.com](https://upstash.com)
2. **Create a database**: 
   - Click "Create Database"
   - Choose "Regional" (faster) or "Global" (multi-region)
   - Select a region close to your Supabase region
3. **Get credentials**:
   - After creation, you'll see:
     - **Endpoint** (host): `xxxxx.upstash.io`
     - **Port**: Usually `6379` or shown in dashboard
     - **Password**: A long token string (copy this!)

4. **Add to .env**:
```env
REDIS_HOST=xxxxx.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-upstash-password-token-here
```

### Option 2: Redis Cloud (Redis Labs)

1. **Sign up**: Go to [https://redis.com/try-free](https://redis.com/try-free)
2. **Create a database**:
   - Choose a plan (free tier available)
   - Select region
3. **Get credentials**:
   - Go to your database → "Configuration"
   - Copy:
     - **Endpoint** (host)
     - **Port**
     - **Default user password**

4. **Add to .env**:
```env
REDIS_HOST=redis-xxxxx.cloud.redislabs.com
REDIS_PORT=12345
REDIS_PASSWORD=your-redis-cloud-password
```

### Option 3: AWS ElastiCache / Azure Cache

For enterprise setups, you can use:
- AWS ElastiCache for Redis
- Azure Cache for Redis
- Google Cloud Memorystore

These require AWS/Azure/GCP accounts and more complex setup.

---

## What Redis is Used For

Redis is used by your NestJS backend for:

- ✅ **Bull Queue**: Background job processing (CAD file parsing)
- ✅ **Caching**: Temporary data storage
- ✅ **Session storage**: (if you add session management later)

Without Redis, the **Bull queue won't work**, which means:
- ❌ CAD file parsing jobs will fail
- ❌ Background processing won't work

---

## Testing Your Redis Connection

### If using local Redis (Docker):

```bash
# Check if Redis is running
docker ps | grep redis

# Test connection
docker exec -it scaffolding-redis redis-cli ping
# Should return: PONG
```

### If using cloud Redis:

You can test from your backend code or use a Redis client tool.

---

## Current .env Configuration

Based on your setup, you should have:

```env
# For local development (Docker)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# OR for production (Upstash example)
# REDIS_HOST=xxxxx.upstash.io
# REDIS_PORT=6379
# REDIS_PASSWORD=your-upstash-token
```

---

## Summary

| Environment | Password Required? | Where to Get It |
|------------|-------------------|-----------------|
| **Local (Docker)** | ❌ No | Leave `REDIS_PASSWORD=` empty |
| **Upstash** | ✅ Yes | Upstash dashboard → Database → Password |
| **Redis Cloud** | ✅ Yes | Redis Cloud dashboard → Configuration |
| **AWS/Azure/GCP** | ✅ Yes | Cloud provider console |

---

## Quick Start for Local Development

1. **Start Redis with Docker**:
   ```bash
   docker-compose up -d redis
   ```

2. **Set in .env**:
   ```env
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=
   ```

3. **Done!** Your backend will connect automatically.

---

## If You Don't Want to Use Redis Right Now

If you want to skip Redis for now (not recommended, but possible):

1. Comment out Bull queue usage in your code
2. Set dummy values in .env (backend will fail to connect but won't crash if you handle errors)
3. **Better option**: Just use local Redis with Docker - it's free and easy!

---

## Troubleshooting

### "Connection refused" error
- Make sure Redis is running: `docker ps | grep redis`
- Check port 6379 is not blocked by firewall

### "Authentication failed" error
- For local: Make sure `REDIS_PASSWORD=` is empty
- For cloud: Double-check you copied the password correctly (no extra spaces)

### "Cannot connect to Redis"
- Verify `REDIS_HOST` and `REDIS_PORT` are correct
- For cloud services, check if your IP is whitelisted (if required)
