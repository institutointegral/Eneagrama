import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import type { Goal, GoalPeriod, GoalType } from '../lib/database.types';
import { Modal } from '../components/Modal';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Resolves the concrete [start, end] date window a goal's progress is measured
// over "right now": the current calendar month/year for recurring periods, or
// the goal's own explicit range for a custom period.
function resolvePeriodRange(goal: Goal): { start: string; end: string } {
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

interface FormState {
  type: GoalType;
  category_id: string;
  account_id: string;
  target_amount: string;
  period: GoalPeriod;
  start_date: string;
  end_date: string;
  description: string;
}

function emptyForm(): FormState {
  return {
    type: 'budget',
    category_id: '',
    account_id: '',
    target_amount: '',
    period: 'monthly',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
    description: '',
  };
}

export function GoalsPage() {
  const { activeTenant } = useTenant();
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const refresh = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .order('created_at', { ascending: false });
    if (!error && data) {
      setGoals(data);
      await loadProgress(data);
    }
    setLoading(false);
  }, [activeTenant]);

  async function loadProgress(goalsList: Goal[]) {
    const entries: Record<string, number> = {};
    for (const goal of goalsList) {
      if (goal.type === 'budget' && goal.category_id) {
        const { start, end } = resolvePeriodRange(goal);
        const { data } = await supabase
          .from('transactions')
          .select('amount')
          .eq('category_id', goal.category_id)
          .eq('status', 'realized')
          .gte('date', start)
          .lte('date', end);
        entries[goal.id] = (data ?? []).reduce((sum, t) => sum + Number(t.amount), 0);
      } else if (goal.type === 'savings' && goal.account_id) {
        const { data } = await supabase
          .from('transactions')
          .select('amount, type')
          .eq('account_id', goal.account_id)
          .eq('status', 'realized');
        const account = accounts.find((a) => a.id === goal.account_id);
        const net = (data ?? []).reduce(
          (sum, t) => sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)),
          account?.initial_balance ?? 0
        );
        entries[goal.id] = net;
      } else {
        entries[goal.id] = 0;
      }
    }
    setProgress(entries);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeTenant) return;
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from('goals').insert({
      tenant_id: activeTenant.id,
      type: form.type,
      category_id: form.type === 'budget' ? form.category_id || null : null,
      account_id: form.type === 'savings' ? form.account_id || null : null,
      target_amount: Number(form.target_amount),
      period: form.period,
      start_date: form.start_date,
      end_date: form.period === 'custom' ? form.end_date : null,
      description: form.description || null,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    refresh();
  }

  async function handleDelete(goal: Goal) {
    if (!confirm('Excluir esta meta?')) return;
    const { error } = await supabase.from('goals').delete().eq('id', goal.id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Metas</h1>
      </div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : goals.length === 0 ? (
        <div className="empty-state">Nenhuma meta cadastrada ainda.</div>
      ) : (
        <div className="list">
          {goals.map((goal) => {
            const category = categories.find((c) => c.id === goal.category_id);
            const account = accounts.find((a) => a.id === goal.account_id);
            const current = progress[goal.id] ?? 0;
            const ratio = goal.target_amount > 0 ? current / goal.target_amount : 0;
            const isBudget = goal.type === 'budget';
            const over = isBudget && ratio > 1;

            return (
              <div key={goal.id} className="card">
                <div className="card-row">
                  <div>
                    <div className="card-title">
                      {goal.description || (isBudget ? `Orçamento: ${category?.name ?? ''}` : 'Meta de poupança')}
                    </div>
                    <div className="card-subtitle">
                      {isBudget ? 'Orçamento' : 'Poupança'} ·{' '}
                      {goal.period === 'monthly' ? 'Mensal' : goal.period === 'yearly' ? 'Anual' : 'Personalizado'}
                      {account ? ` · ${account.name}` : ''}
                    </div>
                  </div>
                  <button type="button" className="danger-button" onClick={() => handleDelete(goal)}>
                    Excluir
                  </button>
                </div>

                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${over ? 'over' : ''}`}
                    style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                  />
                </div>
                <div className="card-subtitle">
                  {formatCurrency(current)} de {formatCurrency(goal.target_amount)}
                  {over ? ' · acima do orçamento' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="fab"
        onClick={() => {
          setForm(emptyForm());
          setError(null);
          setShowForm(true);
        }}
        aria-label="Nova meta"
      >
        +
      </button>

      {showForm && (
        <Modal title="Nova meta" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Tipo de meta
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as GoalType })}
              >
                <option value="budget">Orçamento (limite de gasto por categoria)</option>
                <option value="savings">Poupança</option>
              </select>
            </label>

            {form.type === 'budget' ? (
              <label>
                Categoria
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  required
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Conta vinculada (opcional)
                <select
                  value={form.account_id}
                  onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                >
                  <option value="">Nenhuma</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Valor alvo
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.target_amount}
                onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
                required
              />
            </label>

            <label>
              Período
              <select
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value as GoalPeriod })}
              >
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>

            <div className="form-row">
              <label>
                Início
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                />
              </label>
              {form.period === 'custom' && (
                <label>
                  Fim
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    required
                  />
                </label>
              )}
            </div>

            <label>
              Descrição (opcional)
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
