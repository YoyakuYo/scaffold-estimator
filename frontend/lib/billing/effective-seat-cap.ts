import type { SubscriptionInfo } from '@/lib/api/subscriptions';

/**
 * Plan seat cap for UI when `seatUsage.limit` lags the company plan
 * (e.g. personal row still 2 while `capabilities.maxSeats` is 5 or 20).
 */
export function effectiveSeatCap(
  sub: Pick<SubscriptionInfo, 'capabilities' | 'seatUsage'>,
): number {
  const cap = sub.capabilities?.maxSeats;
  const lu = sub.seatUsage?.limit ?? 0;
  if (cap != null && cap > 0 && lu < cap) return cap;
  return lu;
}

export function isUnlimitedSeatCap(limit: number): boolean {
  return limit >= 9000;
}
