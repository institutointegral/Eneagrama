import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import type { CategoryType, Recurrence, RecurrenceInterval, Transaction } from '../lib/database.types';
import { Modal } from '../components/Modal';

const INTERVAL_LABELS: Record<RecurrenceInterval, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  yearly: 'Anual',
};

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface FormState {
  description: string;
  amount: string;
  type: CategoryType;
  account_id: string;
  category_id: string;
  interval: RecurrenceInterval;
  reference_day: string;
  reference_month: string;
  start_date: string;
  end_date: string;
}

function emptyForm(accounts: { id: string }[]): FormState {
  return {
    description: '',
    amount: '',
    type: 'expense',
    account_id: accounts[0]?.id ?? '',
    category_id: '',
    interval: 'monthly',
    reference_day: '1',
    reference_month: '1',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
  };
}

export function RecurrencesPage() {
  const { activeTenant } = useTenant();
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm([]));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Transaction[]>([]);

  const refresh = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('recurrences')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .order('created_at', { ascending: false });
    if (!error && data) setRecurrences(data);
    setLoading(false);
  }, [activeTenant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleExpand(r: Recurrence) {
    if (expandedId === r.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(r.id);
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('recurrence_id', r.id)
      .order('date', { ascending: true });
    if (!error && data) setGenerated(data);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeTenant) return;
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from('recurrences').insert({
      tenant_id: activeTenant.id,
      account_id: form.account_id,
      category_id: form.category_id || null,
      description: form.description,
      amount: Number(form.amount),
      type: form.type,
      interval: form.interval,
      reference_day: Number(form.reference_day),
      reference_month: form.interval === 'yearly' ? Number(form.reference_month) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      is_active: true,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    refresh();
  }

  async function toggleActive(r: Recurrence) {
    const { error } = await supabase
      .from('recurrences')
      .update({ is_active: !r.is_active })
      .eq('id', r.id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  async function handleDelete(r: Recurrence) {
    if (!confirm('Excluir esta recorrência? Os lançamentos já gerados permanecem, mas nenhum novo será criado.')) return;
    const { error } = await supabase.from('recurrences').delete().eq('id', r.id);
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
        <h1>Recorrências</h1>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Cada regra gera automaticamente lançamentos projetados para os próximos 12 meses.
      </p>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : recurrences.length === 0 ? (
        <div className="empty-state">Nenhuma recorrência cadastrada ainda.</div>
      ) : (
        <div className="list">
          {recurrences.map((r) => (
            <div key={r.id} className="card">
              <div className="card-row">
                <div>
                  <div className="card-title">
                    {r.description}
                    {!r.is_active && <span className="badge">Inativa</span>}
                  </div>
                  <div className="card-subtitle">
                    {INTERVAL_LABELS[r.interval]} · dia{' '}
                    {r.interval === 'weekly' ? WEEKDAY_LABELS[r.reference_day] : r.reference_day}
                    {r.interval === 'yearly' && r.reference_month ? `/${r.reference_month}` : ''} ·
                    desde {new Date(r.start_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    {r.end_date ? ` até ${new Date(r.end_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                  </div>
                </div>
                <div className={`amount ${r.type}`}>{formatCurrency(r.amount)}</div>
              </div>
              <div className="card-actions">
                <button type="button" className="secondary-button" onClick={() => toggleExpand(r)}>
                  {expandedId === r.id ? 'Ocultar lançamentos' : 'Ver lançamentos gerados'}
                </button>
                <button type="button" className="secondary-button" onClick={() => toggleActive(r)}>
                  {r.is_active ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" className="danger-button" onClick={() => handleDelete(r)}>
                  Excluir
                </button>
              </div>
              {expandedId === r.id && (
                <div className="list" style={{ marginTop: 10 }}>
                  {generated.length === 0 ? (
                    <p className="muted">Nenhum lançamento gerado ainda.</p>
                  ) : (
                    generated.map((t) => (
                      <div key={t.id} className="card-row">
                        <span className="card-subtitle">
                          {new Date(t.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                          {t.status === 'projected' ? ' · Projetado' : ' · Realizado'}
                        </span>
                        <span className={`amount ${t.type}`}>{formatCurrency(t.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="fab"
        onClick={() => {
          setForm(emptyForm(accounts));
          setError(null);
          setShowForm(true);
        }}
        aria-label="Nova recorrência"
      >
        +
      </button>

      {showForm && (
        <Modal title="Nova recorrência" onClose={() => setShowForm(false)}>
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
                Valor
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
              Intervalo
              <select
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value as RecurrenceInterval })}
              >
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </label>

            {form.interval === 'weekly' ? (
              <label>
                Dia da semana
                <select
                  value={form.reference_day}
                  onChange={(e) => setForm({ ...form, reference_day: e.target.value })}
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={i} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="form-row">
                <label>
                  Dia do mês
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.reference_day}
                    onChange={(e) => setForm({ ...form, reference_day: e.target.value })}
                    required
                  />
                </label>
                {form.interval === 'yearly' && (
                  <label>
                    Mês
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={form.reference_month}
                      onChange={(e) => setForm({ ...form, reference_month: e.target.value })}
                      required
                    />
                  </label>
                )}
              </div>
            )}

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
              <label>
                Fim (opcional)
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </label>
            </div>

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
