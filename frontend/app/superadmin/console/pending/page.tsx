'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, type UserProfile } from '@/lib/api/users';
import { Loader2, CheckSquare, Square } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminPendingBulkPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: rows, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
  });

  const pending = useMemo(
    () => (rows ?? []).filter((u) => u.approvalStatus === 'pending'),
    [rows],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map((p) => p.id)));
  };

  const approve = useMutation({
    mutationFn: (ids: string[]) => usersApi.bulkApproveUsers(ids, {}),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  const reject = useMutation({
    mutationFn: (ids: string[]) => usersApi.bulkRejectUsers(ids),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const idsArr = [...selected];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('superadminConsole', 'pending')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('superadminConsole', 'bulkSelected')}: {selected.size} / {pending.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs rounded-lg border border-slate-700 text-slate-300 px-3 py-2 hover:bg-slate-900"
          >
            Toggle all
          </button>
          <button
            type="button"
            disabled={!idsArr.length || approve.isPending}
            onClick={() => approve.mutate(idsArr)}
            className="text-xs rounded-lg bg-emerald-600 text-white font-medium px-3 py-2 disabled:opacity-50"
          >
            {t('superadminConsole', 'approveSelected')}
          </button>
          <button
            type="button"
            disabled={!idsArr.length || reject.isPending}
            onClick={() => {
              if (!window.confirm(`Reject ${idsArr.length} pending signups?`)) return;
              reject.mutate(idsArr);
            }}
            className="text-xs rounded-lg bg-red-600/90 text-white font-medium px-3 py-2 disabled:opacity-50"
          >
            {t('superadminConsole', 'rejectSelected')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20 text-slate-400 gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-800 bg-slate-900/60">
              <tr>
                <th className="px-4 py-3 w-10" />
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Company</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/90">
              {pending.map((u: UserProfile) => (
                <tr key={u.id} className="hover:bg-slate-900/40">
                  <td className="px-4 py-2">
                    <button type="button" aria-label="select" className="text-slate-400" onClick={() => toggle(u.id)}>
                      {selected.has(u.id) ? <CheckSquare className="h-4 w-4 text-amber-400" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-slate-100">{u.email}</td>
                  <td className="px-4 py-2 text-slate-400">{u.companyName ?? u.companyId}</td>
                </tr>
              ))}
              {!pending.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                    No pending signups.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
