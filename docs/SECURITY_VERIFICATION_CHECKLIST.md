# Security hardening — verification checklist

Use this list after deploy or when reviewing releases. Adjust limits in code if your traffic pattern needs it.

## Rate limiting (`@nestjs/throttler`)

- [ ] **Login** (`POST /api/v1/auth/login`): expect HTTP `429` after more than **10 requests per minute** from the same IP (tune if shared-office NAT is an issue).
- [ ] **Register** (`POST /api/v1/auth/register`): **5 per hour** per IP.
- [ ] **Forgot password** (`POST /api/v1/auth/forgot-password`): **8 per 15 minutes** per IP.
- [ ] **Reset password** (`POST /api/v1/auth/reset-password`): **15 per 15 minutes** per IP.
- [ ] **Team invite preview** (`GET /api/v1/auth/team-invites/preview`): **40 per minute** per IP.
- [ ] **Team invite accept signup** (`POST /api/v1/auth/team-invites/accept-signup`): **10 per hour** per IP.
- [ ] **Public contact** (`POST /api/v1/messages/public-contact`): **10 per hour** per IP.
- [ ] **Drawing upload** (`POST /api/v1/drawings/upload`): **40 per minute** per authenticated user/IP.
- [ ] **Vision BIM** (`POST` analyze / extract-dimensions / import-premium-schedule): per-route limits (see controllers).
- [ ] **Default** (all other routes): **120 requests per minute** per IP unless overridden.

## Error logging

- [ ] Trigger a bad request (e.g. validation error) and confirm server logs **do not** print raw passwords; sensitive fields should show `[REDACTED]`.

## JWT and session behavior

- [ ] Set `JWT_EXPIRES_IN` in production if you need a specific session length (default in code is **30 minutes** if unset).
- [ ] After an admin **deactivates** a user or changes **role**, the next API call with an old token should return **401** (user loaded from DB on each JWT request).

## Password policy (new passwords)

- [ ] **Register**, **reset password**, **admin reset**, **change password** (new password), **team invite signup**: new passwords must be at least **10** characters.
- [ ] **Login** still accepts existing accounts with shorter legacy passwords (min length **6** on login body only).

## Optional follow-ups (not implemented here)

- HttpOnly cookies for tokens, CSP headers, authenticated download URLs for `/uploads`.
