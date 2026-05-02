'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { TelemetryWindowDays } from '@/lib/api/platform';
import { platformApi } from '@/lib/api/platform';
import { useI18n } from '@/lib/i18n';
import { AnalyticsOperatorConsole } from '@/components/superadmin/analytics-operator-console';

export default function SuperAdminAnalyticsPage() {
  const { t } = useI18n();
  const [telemetryDays, setTelemetryDays] = useState<TelemetryWindowDays>(14);
  const { data: s, isLoading } = useQuery({
    queryKey: ['platform-analytics-summary', telemetryDays],
    queryFn: () => platformApi.getAnalyticsSummary({ telemetryDays }),
    refetchInterval: 45000,
  });
  const { data: logins } = useQuery({
    queryKey: ['platform-recent-logins'],
    queryFn: platformApi.listRecentLogins,
    refetchInterval: 45000,
  });

  if (isLoading || !s) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400/90" />
        <span className="text-sm text-slate-300">{t('superadminConsole', 'analyticsPageTitle')}</span>
      </div>
    );
  }

  return (
    <AnalyticsOperatorConsole
      summary={s}
      logins={Array.isArray(logins) ? logins : []}
      telemetryDays={telemetryDays}
      onTelemetryDaysChange={setTelemetryDays}
    />
  );
}
