import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import type { Category, Goal, Transaction } from '../lib/database.types';
import { fetchGoalCurrentAmount, goalStatus, GOAL_STATUS_LABELS } from '../lib/goals';
import { CategoryBreakdownChart, type CategoryBreakdownDatum } from '../components/charts/CategoryBreakdownChart';
import { MonthlyTrendChart, type MonthlyTrendDatum } from '../components/charts/MonthlyTrendChart';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function topLevelId(cat: Category | undefined, byId: Map<string, Category>): string | null {
  if (!cat) return null;
  let current = cat;
  const seen = new Set<string>();
  while (current.parent_category_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parent_category_id);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

type BreakdownPeriod = 'this_month' | 'last_month' | 'last_3_months';

function resolveBreakdownRange(option: BreakdownPeriod): { start: string; end: string } {
  const today = new Date();
  if (option === 'this_month') {
    return {
      start: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (option === 'last_month') {
    return {
      start: toISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end: toISODate(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  return {
    start: toISODate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
    end: toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

export function DashboardPage() {
  const { activeTenant } = useTenant();
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [budgetProgress, setBudgetProgress] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [drillParentId, setDrillParentId] = useState<string | null>(null);
  const [breakdownPeriod, setBreakdownPeriod] = useState<BreakdownPeriod>('this_month');

  const refresh = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    const [txRes, goalsRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('tenant_id', activeTenant.id),
      supabase.from('goals').select('*').eq('tenant_id', activeTenant.id),
    ]);
    const tx = txRes.data ?? [];
    const gl = goalsRes.data ?? [];
    setTransactions(tx);
    setGoals(gl);
    const progress: Record<string, number | null> = {};
    for (const g of gl) {
      if (g.type === 'budget') progress[g.id] = await fetchGoalCurrentAmount(g, []);
    }
    setBudgetProgress(progress);
    setLoading(false);
  }, [activeTenant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: keep the summary cards and charts in sync with lançamentos
  // created/edited/settled elsewhere, without a manual reload.
  useEffect(() => {
    if (!activeTenant) return;
    const channel = supabase
      .channel(`dashboard-transactions-${activeTenant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `tenant_id=eq.${activeTenant.id}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTenant, refresh]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // "Saldo disponível" deliberately excludes credit cards: a card's own
  // running total is debt owed, not cash on hand — see the README technical
  // note on credit-card handling.
  const cashAccounts = useMemo(() => accounts.filter((a) => a.type !== 'credit_card'), [accounts]);
  const cashAccountIds = useMemo(() => new Set(cashAccounts.map((a) => a.id)), [cashAccounts]);

  const saldoDisponivel = useMemo(() => {
    const base = cashAccounts.reduce((sum, a) => sum + Number(a.initial_balance), 0);
    return transactions
      .filter((t) => t.status === 'realized' && cashAccountIds.has(t.account_id))
      .reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0) + base;
  }, [cashAccounts, cashAccountIds, transactions]);

  const monthRange = resolveBreakdownRange('this_month');
  const monthTx = useMemo(
    () => transactions.filter((t) => t.date >= monthRange.start && t.date <= monthRange.end),
    [transactions, monthRange.start, monthRange.end]
  );

  const monthRealized = useMemo(
    () =>
      monthTx
        .filter((t) => t.status === 'realized' && cashAccountIds.has(t.account_id))
        .reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0),
    [monthTx, cashAccountIds]
  );
  const monthProjected = useMemo(
    () =>
      monthTx
        .filter((t) => t.status === 'projected' && cashAccountIds.has(t.account_id))
        .reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0),
    [monthTx, cashAccountIds]
  );

  const topCategories = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of monthTx) {
      if (t.type !== 'expense' || t.status !== 'realized' || !t.category_id) continue;
      const id = topLevelId(categoryById.get(t.category_id), categoryById) ?? t.category_id;
      sums.set(id, (sums.get(id) ?? 0) + Number(t.amount));
    }
    return Array.from(sums.entries())
      .map(([id, value]) => ({ id, name: categoryById.get(id)?.name ?? 'Outros', value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [monthTx, categoryById]);

  const breakdownRange = resolveBreakdownRange(breakdownPeriod);
  const breakdownData: CategoryBreakdownDatum[] = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'expense' || t.status !== 'realized' || !t.category_id) continue;
      if (t.date < breakdownRange.start || t.date > breakdownRange.end) continue;
      const cat = categoryById.get(t.category_id);
      if (!cat) continue;
      const top = topLevelId(cat, categoryById);
      if (drillParentId === null) {
        const bucket = top ?? cat.id;
        sums.set(bucket, (sums.get(bucket) ?? 0) + Number(t.amount));
      } else {
        if (top !== drillParentId) continue;
        sums.set(cat.id, (sums.get(cat.id) ?? 0) + Number(t.amount));
      }
    }
    return Array.from(sums.entries()).map(([id, value]) => ({
      id,
      name: categoryById.get(id)?.name ?? 'Outros',
      value,
      hasChildren: drillParentId === null && categories.some((c) => c.parent_category_id === id),
    }));
  }, [transactions, categoryById, categories, breakdownRange.start, breakdownRange.end, drillParentId]);

  const monthlyTrend: MonthlyTrendDatum[] = useMemo(() => {
    const months: MonthlyTrendDatum[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - 5);
    for (let i = 0; i < 6; i++) {
      months.push({
        month: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        label: cursor.toLocaleDateString('pt-BR', { month: 'short' }),
        income: 0,
        expense: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const byKey = new Map(months.map((m) => [m.month, m]));
    for (const t of transactions) {
      if (t.status !== 'realized') continue;
      const bucket = byKey.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === 'income') bucket.income += Number(t.amount);
      else bucket.expense += Number(t.amount);
    }
    return months;
  }, [transactions]);

  const activeBudgetGoals = useMemo(() => {
    const today = toISODate(new Date());
    return goals.filter((g) => {
      if (g.type !== 'budget') return false;
      if (g.period === 'custom') return today >= g.start_date && (g.end_date ? today <= g.end_date : true);
      return true;
    });
  }, [goals]);

  const goalsSummary = useMemo(() => {
    const counts = { on_track: 0, near_limit: 0, over_budget: 0, completed: 0, no_tracking: 0 };
    for (const g of goals) {
      const current = g.type === 'budget' ? budgetProgress[g.id] ?? null : null;
      const status = g.type === 'budget' ? goalStatus(g, current) : 'no_tracking';
      counts[status] += 1;
    }
    return counts;
  }, [goals, budgetProgress]);

  if (loading) return <p className="muted">Carregando...</p>;

  const drillParentCategory = drillParentId ? categoryById.get(drillParentId) : null;

  return (
    <div>
      <div className="page-header">
        <h1>Painel</h1>
      </div>

      <div className="list" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-subtitle">Saldo disponível (exclui cartões)</div>
          <div className="amount income" style={{ fontSize: '1.4em' }}>
            {formatCurrency(saldoDisponivel)}
          </div>
        </div>

        <div className="card">
          <div className="card-subtitle">Este mês</div>
          <div className="card-row" style={{ marginTop: 4 }}>
            <div>
              <div className="card-subtitle">Realizado</div>
              <div className={`amount ${monthRealized >= 0 ? 'income' : 'expense'}`}>
                {formatCurrency(monthRealized)}
              </div>
            </div>
            <div>
              <div className="card-subtitle">Projetado</div>
              <div className={`amount ${monthProjected >= 0 ? 'income' : 'expense'}`}>
                {formatCurrency(monthProjected)}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-subtitle">Maiores categorias de gasto do mês</div>
          {topCategories.length === 0 ? (
            <p className="muted" style={{ marginTop: 6 }}>
              Sem despesas registradas este mês.
            </p>
          ) : (
            topCategories.map((c) => (
              <div key={c.id} className="card-row" style={{ marginTop: 6 }}>
                <span>{c.name}</span>
                <span className="amount expense">{formatCurrency(c.value)}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-row">
            <div className="card-subtitle">Metas de orçamento ativas</div>
            <Link to="/goals" className="link-button">
              Ver metas
            </Link>
          </div>
          <div className="card-subtitle" style={{ marginTop: 6 }}>
            {goalsSummary.over_budget > 0 && `${goalsSummary.over_budget} estourada(s) · `}
            {goalsSummary.near_limit > 0 && `${goalsSummary.near_limit} em atenção · `}
            {goalsSummary.on_track} dentro do previsto
          </div>
        </div>
      </div>

      <div className="section-title">Gastos por categoria</div>
      <div className="filters">
        <select
          value={breakdownPeriod}
          onChange={(e) => {
            setBreakdownPeriod(e.target.value as BreakdownPeriod);
            setDrillParentId(null);
          }}
        >
          <option value="this_month">Este mês</option>
          <option value="last_month">Mês passado</option>
          <option value="last_3_months">Últimos 3 meses</option>
        </select>
      </div>
      {drillParentCategory && (
        <button type="button" className="link-button" onClick={() => setDrillParentId(null)}>
          ← Voltar para categorias
        </button>
      )}
      <CategoryBreakdownChart
        data={breakdownData}
        onBarClick={(id) => {
          if (drillParentId === null) {
            const entry = breakdownData.find((d) => d.id === id);
            if (entry?.hasChildren) setDrillParentId(id);
          }
        }}
      />

      <div className="section-title">Evolução mensal (realizado)</div>
      <MonthlyTrendChart data={monthlyTrend} />

      <div className="section-title">Orçado vs. realizado</div>
      {activeBudgetGoals.length === 0 ? (
        <p className="muted">Nenhuma meta de orçamento ativa no período.</p>
      ) : (
        <div className="list">
          {activeBudgetGoals.map((g) => {
            const current = budgetProgress[g.id] ?? null;
            const status = goalStatus(g, current);
            const ratio = current !== null && g.target_amount > 0 ? current / g.target_amount : 0;
            const category = categoryById.get(g.category_id ?? '');
            return (
              <div key={g.id} className="card">
                <div className="card-row">
                  <span className="card-title">{category?.name ?? g.description ?? 'Orçamento'}</span>
                  <span className={`badge ${status === 'over_budget' ? 'over' : status === 'near_limit' ? 'near' : ''}`}>
                    {GOAL_STATUS_LABELS[status]}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${status === 'over_budget' ? 'over' : status === 'near_limit' ? 'near' : ''}`}
                    style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                  />
                </div>
                <div className="card-subtitle">
                  {formatCurrency(current ?? 0)} de {formatCurrency(g.target_amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
