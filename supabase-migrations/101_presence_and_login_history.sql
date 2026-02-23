-- Migration 101: Presence (last_active_at) and login history for admin dashboard

-- Add last_active_at to users for "who is online" (heartbeat updates this)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active_at ON users(last_active_at);

COMMENT ON COLUMN users.last_active_at IS 'Updated by heartbeat; used to show online users (e.g. within last 3 minutes)';

-- Login history for security/audit (logged on each login)
CREATE TABLE IF NOT EXISTS login_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL,
  ip_address       VARCHAR(45),
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_login_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history(created_at);

COMMENT ON TABLE login_history IS 'One row per successful login for audit and admin visibility';
