'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { platformApi } from '@/lib/api/platform';
import { useI18n } from '@/lib/i18n';
import { AnalyticsCommandCenter } from '@/components/superadmin/analytics-command-center';

export default function SuperAdminAnalyticsPage() {
  const { t } = useI18n();
  const { data: s, isLoading } = useQuery({
    queryKey: ['platform-analytics-summary'],
    queryFn: platformApi.getAnalyticsSummary,
    refetchInterval: 45000,
  });
  const { data: logins, isFetching: lg } = useQuery({
    queryKey: ['platform-recent-logins'],
    queryFn: platformApi.listRecentLogins,
    refetchInterval: 45000,
  });

  if (isLoading || !s) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        <span className="text-sm font-mono">{t('superadminConsole', 'analyticsPageTitle')}</span>
      </div>
    );
  }

  return <AnalyticsCommandCenter summary={s} logins={Array.isArray(logins) ? logins : []} />;
}
