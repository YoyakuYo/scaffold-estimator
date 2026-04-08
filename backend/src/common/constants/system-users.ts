/**
 * Synthetic DB users (not logins) used for internal features.
 * Keep in sync with supabase-migrations/131_landing_contact_inbox_user.sql
 */
export const LANDING_CONTACT_USER_EMAIL = '__landing_contact__@system.local';

const EXCLUDED_FROM_USER_LIST_EMAILS = new Set([LANDING_CONTACT_USER_EMAIL.toLowerCase()]);

/** Hide from admin user lists, company pickers, and tenant stats. */
export function isSyntheticListedUser(email: string | undefined | null): boolean {
  if (!email) return false;
  return EXCLUDED_FROM_USER_LIST_EMAILS.has(email.trim().toLowerCase());
}
