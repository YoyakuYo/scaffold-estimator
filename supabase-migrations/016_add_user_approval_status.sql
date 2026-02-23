-- Migration 016: Add approval status to users table
-- This enables the registration workflow where users register and wait for admin approval

-- Create approval_status enum type
DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add approval_status column to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS approval_status approval_status NOT NULL DEFAULT 'approved';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status);

-- Update existing users to 'approved' status (they were created by admin, so they're already approved)
-- This ensures backward compatibility
UPDATE users SET approval_status = 'approved' WHERE approval_status IS NULL;

-- Add comment
COMMENT ON COLUMN users.approval_status IS 'User registration approval status: pending (waiting for admin), approved (can login), rejected (denied access)';
