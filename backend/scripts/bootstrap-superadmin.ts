/**
 * One-off bootstrap: promotes an existing approved user to superadmin by email.
 * Requires Supabase REST env (same as Nest): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   PLATFORM_BOOTSTRAP_SUPERADMIN_EMAIL=you@domain.com npm run bootstrap:superadmin
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';

async function main() {
  const email = process.env.PLATFORM_BOOTSTRAP_SUPERADMIN_EMAIL?.trim();
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!email) {
    console.error('PLATFORM_BOOTSTRAP_SUPERADMIN_EMAIL is required.');
    process.exit(1);
  }
  if (!url || !serviceKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, approval_status')
    .ilike('email', email)
    .maybeSingle();

  if (fetchErr) {
    console.error('Lookup failed:', fetchErr.message);
    process.exit(1);
  }
  if (!rows) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }
  const u = rows as { id: string; approval_status: string };
  if (u.approval_status !== 'approved') {
    console.error(`User exists but approval_status=${u.approval_status}; approve first.`);
    process.exit(1);
  }

  const { error: updErr } = await supabase
    .from('users')
    .update({ role: 'superadmin', updated_at: new Date().toISOString() })
    .eq('id', u.id);

  if (updErr) {
    console.error('Update failed:', updErr.message);
    process.exit(1);
  }

  console.log(`OK — ${email} is now role=superadmin (id=${u.id}). Use /superadmin to sign in.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
