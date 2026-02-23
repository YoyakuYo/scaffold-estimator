-- Migration 103: In-app notifications (approval, new message, etc.)

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL,
  type            VARCHAR(50) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  link             VARCHAR(512),
  read_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

COMMENT ON TABLE notifications IS 'In-app notification center; types: approval, rejection, new_message, system';
