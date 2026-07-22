import { supabase } from './supabaseClient';
import type { Account, Goal } from './database.types';

export type GoalStatus = 'on_track' | 'near_limit' | 'over_budget' | 'completed' | 'no_tracking';

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'Dentro do previsto',
  near_limit: 'Atenção',
  over_budget: 'Estourada',
  completed: 'Concluída',
  no_tracking: 'Sem acompanhamento automático',
};

// Resolves the concrete [start, end] date window a goal's progress is measured
// over "right now": the current calendar month/year for recurring periods, or
// the goal's own explicit range for a custom period.
export function resolvePeriodRange(goal: Goal): { start: string; end: string } {
  const today = new Date();
  if (goal.period === 'monthly') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (goal.period === 'yearly') {
    return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` };
  }
  return { start: goal.start_date, end: goal.end_date ?? goal.start_date };
}

// Current progress amount for a goal, or null when there's no data source to
// compute it automatically (a savings goal with no linked account — see the
// "Nota técnica" in the README for why this is the chosen simplification).
export async function fetchGoalCurrentAmount(
  goal: Goal,
  accounts: Pick<Account, 'id' | 'initial_balance'>[]
): Promise<number | null> {
  if (goal.type === 'budget') {
    if (!goal.category_id) return 0;
    const { start, end } = resolvePeriodRange(goal);
    const { data } = await supabase
      .from('transactions')
      .select('amount')
      .eq('category_id', goal.category_id)
      .eq('type', 'expense')
      .eq('status', 'realized')
      .gte('date', start)
      .lte('date', end);
    return (data ?? []).reduce((sum, t) => sum + Number(t.amount), 0);
  }

  // savings
  if (!goal.account_id) return null;
  const { data } = await supabase
    .from('transactions')
    .select('amount, type')
    .eq('account_id', goal.account_id)
    .eq('status', 'realized')
    .gte('date', goal.start_date);
  const account = accounts.find((a) => a.id === goal.account_id);
  return (data ?? []).reduce(
    (sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)),
    account?.initial_balance ?? 0
  );
}

export function goalStatus(goal: Goal, current: number | null): GoalStatus {
  if (current === null) return 'no_tracking';
  const ratio = goal.target_amount > 0 ? current / goal.target_amount : 0;

  if (goal.type === 'savings') {
    return ratio >= 1 ? 'completed' : 'on_track';
  }

  if (ratio >= 1) return 'over_budget';
  if (ratio >= 0.8) return 'near_limit';
  return 'on_track';
}
