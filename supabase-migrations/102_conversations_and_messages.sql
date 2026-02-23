-- Migration 102: Internal messaging (admin <-> user support)

-- One conversation per user (with platform admin). Admin sees all; user sees only their own.
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- Messages in a conversation
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id    UUID NOT NULL,
  sender_id          UUID NOT NULL,
  body               TEXT NOT NULL,
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

COMMENT ON TABLE conversations IS 'Support conversation: one per user, with platform admin';
COMMENT ON TABLE messages IS 'Messages in support conversations; read_at set when recipient reads';
