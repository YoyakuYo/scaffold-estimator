'use client';

import { SuperAdminNavigation } from '@/components/superadmin-navigation';
import { SuperAdminDashboardContent } from '@/components/superadmin-dashboard-content';

export default function SuperAdminDashboardPage() {
  return (
    <>
      <SuperAdminNavigation />
      <SuperAdminDashboardContent />
    </>
  );
}
