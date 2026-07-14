import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import type { Account, AccountType, Transaction } from '../lib/database.types';
import { Modal } from '../components/Modal';
import { computeOpenInvoice, currentCardCycle } from '../lib/cashFlow';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  wallet: 'Carteira',
  credit_card: 'Cartão de crédito',
  investment: 'Investimento',
};

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface FormState {
  name: string;
  type: AccountType;
  initial_balance: string;
  is_active: boolean;
  closing_day: string;
  due_day: string;
  credit_limit: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'checking',
  initial_balance: '0',
  is_active: true,
  closing_day: '',
  due_day: '',
  credit_limit: '',
};

export function AccountsPage() {
  const { activeTenant } = useTenant();
  const { accounts, loading, refresh } = useAccounts();
  const [editing, setEditing] = useState<Account | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!activeTenant) return;
    supabase
      .from('transactions')
      .select('account_id, amount, type, status, date')
      .eq('tenant_id', activeTenant.id)
      .then(({ data }) => setTransactions((data ?? []) as Transaction[]));
  }, [activeTenant]);

  // Saldo atual = saldo inicial + realizados daquela conta. Para cartão de
  // crédito, isso é o "saldo" da própria conta cartão (quanto já foi
  // debitado dela até agora); a fatura em aberto do ciclo é um número à
  // parte, calculado abaixo.
  const currentBalanceByAccount = useMemo(() => {
    const balances = new Map<string, number>();
    for (const account of accounts) balances.set(account.id, Number(account.initial_balance));
    for (const t of transactions) {
      if (t.status !== 'realized') continue;
      const current = balances.get(t.account_id);
      if (current === undefined) continue;
      balances.set(t.account_id, current + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)));
    }
    return balances;
  }, [accounts, transactions]);

  const openInvoiceByAccount = useMemo(() => {
    const invoices = new Map<string, number>();
    for (const account of accounts) {
      if (account.type !== 'credit_card' || account.closing_day == null || account.due_day == null) continue;
      const cycle = currentCardCycle(account.closing_day, account.due_day);
      invoices.set(account.id, computeOpenInvoice(transactions, account.id, cycle));
    }
    return invoices;
  }, [accounts, transactions]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  function openEdit(account: Account) {
    setEditing(account);
    setForm({
      name: account.name,
      type: account.type,
      initial_balance: String(account.initial_balance),
      is_active: account.is_active,
      closing_day: account.closing_day != null ? String(account.closing_day) : '',
      due_day: account.due_day != null ? String(account.due_day) : '',
      credit_limit: account.credit_limit != null ? String(account.credit_limit) : '',
    });
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeTenant) return;
    setSubmitting(true);
    setError(null);

    const payload = {
      tenant_id: activeTenant.id,
      name: form.name,
      type: form.type,
      initial_balance: Number(form.initial_balance || 0),
      is_active: form.is_active,
      closing_day: form.type === 'credit_card' && form.closing_day ? Number(form.closing_day) : null,
      due_day: form.type === 'credit_card' && form.due_day ? Number(form.due_day) : null,
      credit_limit: form.type === 'credit_card' && form.credit_limit ? Number(form.credit_limit) : null,
    };

    const { error } = editing
      ? await supabase.from('accounts').update(payload).eq('id', editing.id)
      : await supabase.from('accounts').insert(payload);

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    refresh();
  }

  async function handleDelete(account: Account) {
    if (!confirm(`Excluir a conta "${account.name}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from('accounts').delete().eq('id', account.id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Contas</h1>
      </div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : accounts.length === 0 ? (
        <div className="empty-state">Nenhuma conta cadastrada ainda.</div>
      ) : (
        <div className="list">
          {accounts.map((account) => {
            const currentBalance = currentBalanceByAccount.get(account.id) ?? account.initial_balance;
            const openInvoice = openInvoiceByAccount.get(account.id);
            return (
            <div key={account.id} className="card">
              <div className="card-row">
                <div>
                  <div className="card-title">
                    {account.name}
                    {!account.is_active && <span className="badge">Inativa</span>}
                  </div>
                  <div className="card-subtitle">{ACCOUNT_TYPE_LABELS[account.type]}</div>
                  {account.type === 'credit_card' && (
                    <div className="card-subtitle">
                      Fechamento dia {account.closing_day} · Vencimento dia {account.due_day}
                      {account.credit_limit != null && ` · Limite ${formatCurrency(account.credit_limit)}`}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="card-subtitle">
                    {account.type === 'credit_card' ? 'Saldo devedor' : 'Saldo atual'}
                  </div>
                  <div className={`amount ${currentBalance < 0 ? 'expense' : 'income'}`}>
                    {formatCurrency(currentBalance)}
                  </div>
                </div>
              </div>
              {account.type === 'credit_card' && openInvoice !== undefined && (
                <div className="card-row" style={{ marginTop: 6 }}>
                  <span className="card-subtitle">Fatura em aberto (ciclo vigente)</span>
                  <span className="amount expense">{formatCurrency(openInvoice)}</span>
                </div>
              )}
              <div className="card-actions">
                <button type="button" className="secondary-button" onClick={() => openEdit(account)}>
                  Editar
                </button>
                <button type="button" className="danger-button" onClick={() => handleDelete(account)}>
                  Excluir
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <button type="button" className="fab" onClick={openCreate} aria-label="Nova conta">
        +
      </button>

      {showForm && (
        <Modal title={editing ? 'Editar conta' : 'Nova conta'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Nome
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Tipo
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Saldo inicial
              <input
                type="number"
                step="0.01"
                value={form.initial_balance}
                onChange={(e) => setForm({ ...form, initial_balance: e.target.value })}
                required
              />
            </label>

            {form.type === 'credit_card' && (
              <>
                <div className="form-row">
                  <label>
                    Dia de fechamento
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.closing_day}
                      onChange={(e) => setForm({ ...form, closing_day: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Dia de vencimento
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.due_day}
                      onChange={(e) => setForm({ ...form, due_day: e.target.value })}
                      required
                    />
                  </label>
                </div>
                <label>
                  Limite de crédito
                  <input
                    type="number"
                    step="0.01"
                    value={form.credit_limit}
                    onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                  />
                </label>
              </>
            )}

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Conta ativa
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
