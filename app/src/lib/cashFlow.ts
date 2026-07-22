import type { Account, Transaction } from './database.types';

export type AccountScope = 'all' | 'all_no_cc' | string;

export function accountsInScope(accounts: Account[], scope: AccountScope): Account[] {
  if (scope === 'all') return accounts;
  if (scope === 'all_no_cc') return accounts.filter((a) => a.type !== 'credit_card');
  return accounts.filter((a) => a.id === scope);
}

function clampDay(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

export interface CardCycle {
  start: Date;
  end: Date;
  dueDate: Date;
}

// The current billing cycle for a credit_card account: purchases dated in
// [start, end] belong to the invoice that closes on `end` and is due on
// `dueDate`. Assumes due_day can be on either side of closing_day within the
// month (e.g. closes day 28, due day 5 of the *following* month is the common
// case handled here) — see the README "Nota técnica" for the exact rule.
export function currentCardCycle(closingDay: number, dueDay: number, reference: Date = new Date()): CardCycle {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  const thisMonthClose = clampDay(y, m, closingDay);

  let cycleEnd: Date;
  if (reference <= thisMonthClose) {
    cycleEnd = thisMonthClose;
  } else {
    cycleEnd = clampDay(y, m + 1, closingDay);
  }

  const prevClose = clampDay(cycleEnd.getFullYear(), cycleEnd.getMonth() - 1, closingDay);
  const cycleStart = new Date(prevClose);
  cycleStart.setDate(cycleStart.getDate() + 1);

  const dueMonth = dueDay <= closingDay ? cycleEnd.getMonth() + 1 : cycleEnd.getMonth();
  const dueDate = clampDay(cycleEnd.getFullYear(), dueMonth, dueDay);

  return { start: cycleStart, end: cycleEnd, dueDate };
}

// Sum of a credit card's transactions dated within a billing cycle: the
// invoice amount for that cycle. Income-type entries (e.g. a refund posted to
// the card) reduce it.
export function computeOpenInvoice(
  transactions: Pick<Transaction, 'account_id' | 'amount' | 'type' | 'date'>[],
  cardAccountId: string,
  cycle: Pick<CardCycle, 'start' | 'end'>
): number {
  const startStr = cycle.start.toISOString().slice(0, 10);
  const endStr = cycle.end.toISOString().slice(0, 10);
  return transactions
    .filter((t) => t.account_id === cardAccountId && t.date >= startStr && t.date <= endStr)
    .reduce((sum, t) => sum + (t.type === 'expense' ? Number(t.amount) : -Number(t.amount)), 0);
}

export type CashFlowGranularity = 'day' | 'month';

export interface CashFlowPoint {
  key: string;
  label: string;
  realizedBalance: number;
  combinedBalance: number;
}

function bucketKey(dateStr: string, granularity: CashFlowGranularity) {
  return granularity === 'day' ? dateStr : dateStr.slice(0, 7);
}

// Day-by-day or month-by-month running balance: initial_balance of the
// in-scope accounts, plus every transaction up to and including each bucket,
// as two cumulative lines — realized-only, and realized+projected combined —
// so the UI can show either or both depending on the status filter.
export function computeCashFlow(
  accounts: Pick<Account, 'initial_balance'>[],
  transactions: Pick<Transaction, 'amount' | 'type' | 'date' | 'status'>[],
  periodStart: string,
  periodEnd: string,
  granularity: CashFlowGranularity
): CashFlowPoint[] {
  const baseBalance = accounts.reduce((sum, a) => sum + Number(a.initial_balance), 0);
  const startKey = bucketKey(periodStart, granularity);

  let runningRealized = baseBalance;
  let runningCombined = baseBalance;

  const byBucket = new Map<string, { realized: number; combined: number }>();
  for (const t of transactions) {
    const key = bucketKey(t.date, granularity);
    const signed = (t.type === 'income' ? 1 : -1) * Number(t.amount);
    if (key < startKey) {
      if (t.status === 'realized') runningRealized += signed;
      runningCombined += signed;
      continue;
    }
    const entry = byBucket.get(key) ?? { realized: 0, combined: 0 };
    if (t.status === 'realized') entry.realized += signed;
    entry.combined += signed;
    byBucket.set(key, entry);
  }

  const points: CashFlowPoint[] = [];
  const cursor = new Date(periodStart + 'T00:00:00');
  const end = new Date(periodEnd + 'T00:00:00');
  while (cursor <= end) {
    const key =
      granularity === 'day'
        ? cursor.toISOString().slice(0, 10)
        : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const entry = byBucket.get(key) ?? { realized: 0, combined: 0 };
    runningRealized += entry.realized;
    runningCombined += entry.combined;
    points.push({
      key,
      label:
        granularity === 'day'
          ? cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      realizedBalance: runningRealized,
      combinedBalance: runningCombined,
    });
    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}
