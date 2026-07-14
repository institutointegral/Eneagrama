import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import type { CategoryType, Transaction, TransactionForm, TransactionStatus } from '../lib/database.types';
import { Modal } from '../components/Modal';

type TransactionRow = Transaction & {
  accounts: { name: string } | null;
  categories: { name: string } | null;
};

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function lastDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

interface Filters {
  accountId: string;
  categoryId: string;
  status: '' | TransactionStatus;
  type: '' | CategoryType;
  startDate: string;
  endDate: string;
}

interface FormState {
  description: string;
  amount: string;
  type: CategoryType;
  account_id: string;
  category_id: string;
  date: string;
  status: TransactionStatus;
  form: TransactionForm;
  installment_total: string;
  first_installment_realized: boolean;
}

function emptyForm(accounts: { id: string }[]): FormState {
  return {
    description: '',
    amount: '',
    type: 'expense',
    account_id: accounts[0]?.id ?? '',
    category_id: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'realized',
    form: 'cash',
    installment_total: '2',
    first_installment_realized: true,
  };
}

export function TransactionsPage() {
  const { activeTenant } = useTenant();
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  const [filters, setFilters] = useState<Filters>({
    accountId: '',
    categoryId: '',
    status: '',
    type: '',
    startDate: firstDayOfMonth(),
    endDate: lastDayOfMonth(),
  });

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm([]));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    let query = supabase
      .from('transactions')
      .select('*, accounts(name), categories(name)')
      .eq('tenant_id', activeTenant.id)
      .gte('date', filters.startDate)
      .lte('date', filters.endDate)
      .order('date', { ascending: false });

    if (filters.accountId) query = query.eq('account_id', filters.accountId);
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);

    const { data, error } = await query;
    if (!error && data) setTransactions(data as unknown as TransactionRow[]);
    setLoading(false);
  }, [activeTenant, filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: reflect inserts/updates/deletes from other tabs, devices, or
  // (later) automated sources without requiring a manual reload. RLS already
  // scopes what this subscription can see to the active tenant's rows.
  useEffect(() => {
    if (!activeTenant) return;
    const channel = supabase
      .channel(`transactions-${activeTenant.id}`)
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

  const summary = useMemo(() => {
    const totals = { realizedIncome: 0, realizedExpense: 0, projectedIncome: 0, projectedExpense: 0 };
    for (const t of transactions) {
      const bucket = t.status === 'realized' ? 'realized' : 'projected';
      const key = `${bucket}${t.type === 'income' ? 'Income' : 'Expense'}` as keyof typeof totals;
      totals[key] += Number(t.amount);
    }
    return totals;
  }, [transactions]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(accounts));
    setError(null);
    setShowForm(true);
  }

  function openEdit(t: Transaction) {
    setEditing(t);
    setForm({
      description: t.description,
      amount: String(t.amount),
      type: t.type,
      account_id: t.account_id,
      category_id: t.category_id ?? '',
      date: t.date,
      status: t.status,
      form: t.form,
      installment_total: String(t.installment_total ?? 2),
      first_installment_realized: true,
    });
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeTenant) return;
    setSubmitting(true);
    setError(null);

    const amount = Number(form.amount);
    const basePayload = {
      tenant_id: activeTenant.id,
      account_id: form.account_id,
      category_id: form.category_id || null,
      description: form.description,
      type: form.type,
    };

    if (editing) {
      const { error } = await supabase
        .from('transactions')
        .update({
          ...basePayload,
          amount,
          date: form.date,
          status: form.status,
        })
        .eq('id', editing.id);
      setSubmitting(false);
      if (error) {
        setError(error.message);
        return;
      }
      setShowForm(false);
      refresh();
      return;
    }

    if (form.form === 'cash') {
      const { error } = await supabase.from('transactions').insert({
        ...basePayload,
        amount,
        date: form.date,
        status: form.status,
        form: 'cash',
      });
      setSubmitting(false);
      if (error) {
        setError(error.message);
        return;
      }
      setShowForm(false);
      refresh();
      return;
    }

    // Installment: create N rows sharing installment_group_id, one per month.
    const total = Math.max(2, Number(form.installment_total));
    const groupId = crypto.randomUUID();
    const startDate = new Date(form.date + 'T00:00:00');
    const rows = Array.from({ length: total }, (_, i) => {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      return {
        ...basePayload,
        amount,
        date: d.toISOString().slice(0, 10),
        status: (i === 0 && form.first_installment_realized ? 'realized' : 'projected') as TransactionStatus,
        form: 'installment' as const,
        installment_group_id: groupId,
        installment_number: i + 1,
        installment_total: total,
      };
    });

    const { error } = await supabase.from('transactions').insert(rows);
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    refresh();
  }

  async function handleDelete(t: Transaction) {
    if (!confirm('Excluir este lançamento?')) return;
    const { error } = await supabase.from('transactions').delete().eq('id', t.id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  async function handleSettle(t: Transaction) {
    if (!confirm('Marcar este lançamento projetado como realizado?')) return;
    const { error } = await supabase.rpc('settle_transaction', { p_projected_id: t.id });
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  const categoryOptionsForType = categories.filter((c) => c.type === form.type);

  return (
    <div>
      <div className="page-header">
        <h1>Lançamentos</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-row">
          <div>
            <div className="card-subtitle">Realizado</div>
            <div className="amount income">{formatCurrency(summary.realizedIncome)}</div>
            <div className="amount expense">{formatCurrency(-summary.realizedExpense)}</div>
          </div>
          <div>
            <div className="card-subtitle">Projetado</div>
            <div className="amount income">{formatCurrency(summary.projectedIncome)}</div>
            <div className="amount expense">{formatCurrency(-summary.projectedExpense)}</div>
          </div>
        </div>
      </div>

      <div className="filters">
        <select
          value={filters.accountId}
          onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
        >
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={filters.categoryId}
          onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters['status'] })}
        >
          <option value="">Realizado + Projetado</option>
          <option value="realized">Realizado</option>
          <option value="projected">Projetado</option>
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}
        >
          <option value="">Receita + Despesa</option>
          <option value="income">Receita</option>
          <option value="expense">Despesa</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
        />
      </div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : transactions.length === 0 ? (
        <div className="empty-state">Nenhum lançamento no período selecionado.</div>
      ) : (
        <div className="list">
          {transactions.map((t) => (
            <div key={t.id} className="card">
              <div className="card-row">
                <div>
                  <div className="card-title">
                    {t.description}
                    {t.status === 'projected' && (
                      <span className="badge">Projetado</span>
                    )}
                    {t.settled_by && <span className="badge settled">Baixado</span>}
                    {t.form === 'installment' && (
                      <span className="badge">
                        {t.installment_number}/{t.installment_total}
                      </span>
                    )}
                  </div>
                  <div className="card-subtitle">
                    {new Date(t.date + 'T00:00:00').toLocaleDateString('pt-BR')} ·{' '}
                    {t.accounts?.name} {t.categories?.name ? `· ${t.categories.name}` : ''}
                  </div>
                </div>
                <div className={`amount ${t.type}`}>
                  {t.type === 'expense' ? '-' : ''}
                  {formatCurrency(t.amount)}
                </div>
              </div>
              <div className="card-actions">
                <button type="button" className="secondary-button" onClick={() => openEdit(t)}>
                  Editar
                </button>
                <button type="button" className="danger-button" onClick={() => handleDelete(t)}>
                  Excluir
                </button>
                {t.status === 'projected' && !t.settled_by && (
                  <button type="button" className="primary-button" onClick={() => handleSettle(t)}>
                    Marcar como realizado
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="fab" onClick={openCreate} aria-label="Novo lançamento">
        +
      </button>

      {showForm && (
        <Modal title={editing ? 'Editar lançamento' : 'Novo lançamento'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Descrição
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
            </label>

            <div className="form-row">
              <label>
                Tipo
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value as CategoryType, category_id: '' })
                  }
                >
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </label>
              <label>
                Valor {form.form === 'installment' ? '(por parcela)' : ''}
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                Conta
                <select
                  value={form.account_id}
                  onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                  required
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Categoria
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
                  <option value="">Sem categoria</option>
                  {categoryOptionsForType.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Data {form.form === 'installment' ? 'da 1ª parcela' : ''}
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </label>

            {!editing && (
              <label>
                Forma
                <select
                  value={form.form}
                  onChange={(e) => setForm({ ...form, form: e.target.value as TransactionForm })}
                >
                  <option value="cash">À vista</option>
                  <option value="installment">Parcelado</option>
                </select>
              </label>
            )}

            {form.form === 'cash' || editing ? (
              <label>
                Situação
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as TransactionStatus })}
                >
                  <option value="realized">Realizado</option>
                  <option value="projected">Projetado</option>
                </select>
              </label>
            ) : (
              <>
                <label>
                  Número de parcelas
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={form.installment_total}
                    onChange={(e) => setForm({ ...form, installment_total: e.target.value })}
                    required
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.first_installment_realized}
                    onChange={(e) =>
                      setForm({ ...form, first_installment_realized: e.target.checked })
                    }
                  />
                  Primeira parcela já realizada
                </label>
              </>
            )}

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
