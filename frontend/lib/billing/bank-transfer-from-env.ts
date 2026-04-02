import type { BankTransferInstructions } from '@/lib/api/subscriptions';

/**
 * Optional fallback when the API does not return bankTransfer yet (older backend)
 * or when you prefer configuring the hosting provider’s frontend env only.
 * Set NEXT_PUBLIC_BANK_TRANSFER_* in the frontend build environment.
 */
export function bankTransferFromPublicEnv(remittanceReference: string): BankTransferInstructions | null {
  const flag = (process.env.NEXT_PUBLIC_BANK_TRANSFER_ENABLED || '').toLowerCase();
  if (!['true', '1', 'yes'].includes(flag)) return null;
  const bankName = process.env.NEXT_PUBLIC_BANK_TRANSFER_BANK_NAME?.trim();
  const branch = process.env.NEXT_PUBLIC_BANK_TRANSFER_BRANCH?.trim();
  const accountType = process.env.NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_TYPE?.trim();
  const accountNumber = process.env.NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_NUMBER?.trim();
  const accountHolder = process.env.NEXT_PUBLIC_BANK_TRANSFER_ACCOUNT_HOLDER?.trim();
  if (!bankName || !branch || !accountType || !accountNumber || !accountHolder) return null;
  const amountNote = process.env.NEXT_PUBLIC_BANK_TRANSFER_AMOUNT_NOTE?.trim();
  return {
    bankName,
    branch,
    accountType,
    accountNumber,
    accountHolder,
    remittanceReference: remittanceReference || '—',
    ...(amountNote ? { amountNote } : {}),
  };
}
