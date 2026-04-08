-- Synthetic user so the public landing contact form can post into support Messages (/admin/messages).
-- Password is random; account is not for login. Backend looks up by email.

INSERT INTO users (company_id, email, password_hash, role, approval_status, is_active, first_name, last_name)
SELECT c.id,
  '__landing_contact__@system.local',
  '$2b$10$n8Z3zJ92kVseaZ2C9DtWLen18hTk/EWZIXfjHqH//IvEKap4ZKIvy',
  'viewer',
  'approved',
  true,
  'Public',
  'Landing form'
FROM companies c
ORDER BY c.created_at ASC
LIMIT 1
ON CONFLICT (email) DO NOTHING;
