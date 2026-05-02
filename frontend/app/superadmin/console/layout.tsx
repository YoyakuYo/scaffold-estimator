'use client';

import { SuperAdminConsoleShell } from '@/components/superadmin/super-admin-console-shell';

export default function SuperAdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminConsoleShell>{children}</SuperAdminConsoleShell>;
}
