'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { Loader2, KeyRound } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminSecurityPage() {
  const { t } = useI18n();
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const begin = useMutation({
    mutationFn: authApi.beginTotp,
    onSuccess: (d) => {
      setSecret(d.secret);
      setUri(d.otpauthUri);
    },
  });

  const confirm = useMutation({
    mutationFn: () => {
      if (!secret) throw new Error('no secret');
      return authApi.confirmTotp(secret, code.trim());
    },
    onSuccess: () => {
      setCode('');
      setSecret(null);
      setUri(null);
    },
  });

  const disable = useMutation({ mutationFn: authApi.disableTotp });

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-amber-400" />
          {t('superadminConsole', 'totpHeading')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">Google Authenticator, 1Password, etc.</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <button
          type="button"
          className="rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2 inline-flex items-center gap-2 disabled:opacity-50"
          onClick={() => begin.mutate()}
          disabled={begin.isPending}
        >
          {begin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('superadminConsole', 'totpGenerate')}
        </button>
        {uri && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 break-all">otpauth:… {uri.slice(0, 80)}…</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm px-3 py-2"
                placeholder={t('superadminConsole', 'totpConfirmPlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                disabled={confirm.isPending || code.trim().length < 6}
                onClick={() => confirm.mutate()}
                className="rounded-lg bg-white text-slate-900 font-semibold text-sm px-4 py-2"
              >
                {t('superadminConsole', 'totpEnable')}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="text-sm text-red-400 hover:text-red-300 underline disabled:opacity-50"
        onClick={() => disable.mutate()}
        disabled={disable.isPending}
      >
        {disable.isPending ? '…' : t('superadminConsole', 'totpDisable')}
      </button>
    </div>
  );
}
