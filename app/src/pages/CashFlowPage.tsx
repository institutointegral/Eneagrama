import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useAccounts } from '../hooks/useAccounts';
import type { Transaction } from '../lib/database.types';
import {
  accountsInScope,
  computeCashFlow,
  computeOpenInvoice,
  currentCardCycle,
  type AccountScope,
  type CashFlowGranularity,
} from '../lib/cashFlow';
import { CashFlowLineChart } from '../components/charts/CashFlowLineChart';

type PeriodOption = 'current_month' | 'next_3' | 'next_6' | 'next_12' | 'custom';
type StatusOption = 'realized' | 'projected' | 'both';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(option: PeriodOption, customStart: string, customEnd: string): { start: string; end: string; granularity: CashFlowGranularity } {
  const today = new Date();
  if (option === 'current_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: toISODate(start), end: toISODate(end), granularity: 'day' };
  }
  if (option === 'custom') {
    const days = (new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000;
    return { start: customStart, end: customEnd, granularity: days <= 45 ? 'day' : 'month' };
  }
  const months = option === 'next_3' ? 3 : option === 'next_6' ? 6 : 12;
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + months, 0);
  return { start: toISODate(start), end: toISODate(end), granularity: 'month' };
}

export function CashFlowPage() {
  const { activeTenant } = useTenant();
  const { accounts } = useAccounts();

  const [scope, setScope] = useState<AccountScope>('all');
  const [statusOption, setStatusOption] = useState<StatusOption>('both');
  const [periodOption, setPeriodOption] = useState<PeriodOption>('current_month');
  const [customStart, setCustomStart] = useState(toISODate(new Date()));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date(new Date().setMonth(new Date().getMonth() + 1))));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { start: periodStart, end: periodEnd, granularity } = resolvePeriod(periodOption, customStart, customEnd);

  const scopedAccounts = useMemo(() => accountsInScope(accounts, scope), [accounts, scope]);
  const singleCardAccount = scopedAccounts.length === 1 && scopedAccounts[0].type === 'credit_card' ? scopedAccounts[0] : null;

  useEffect(() => {
    if (!activeTenant || scopedAccounts.length === 0) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('transactions')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .in('account_id', scopedAccounts.map((a) => a.id))
      .lte('date', periodEnd)
      .order('date', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setTransactions(data);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant, scope, periodEnd]);

  const chartData = useMemo(
    () => computeCashFlow(scopedAccounts, transactions, periodStart, periodEnd, granularity),
    [scopedAccounts, transactions, periodStart, periodEnd, granularity]
  );

  const invoice = useMemo(() => {
    if (!singleCardAccount || singleCardAccount.closing_day == null || singleCardAccount.due_day == null) return null;
    const cycle = currentCardCycle(singleCardAccount.closing_day, singleCardAccount.due_day);
    const amount = computeOpenInvoice(transactions, singleCardAccount.id, cycle);
    return { cycle, amount };
  }, [singleCardAccount, transactions]);

  const showRealized = statusOption === 'realized' || statusOption === 'both';
  const showCombined = statusOption === 'projected' || statusOption === 'both';

  const lastPoint = chartData[chartData.length - 1];
  const willGoNegative = chartData.some((p) => (showCombined ? p.combinedBalance : p.realizedBalance) < 0);

  return (
    <div>
      <div className="page-header">
        <h1>Fluxo de Caixa</h1>
      </div>

      <div className="filters">
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Consolidado (todas as contas)</option>
          <option value="all_no_cc">Consolidado sem cartões de crédito</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={statusOption} onChange={(e) => setStatusOption(e.target.value as StatusOption)}>
          <option value="both">Realizado + projetado</option>
          <option value="realized">Só realizado</option>
          <option value="projected">Só projetado</option>
        </select>
        <select value={periodOption} onChange={(e) => setPeriodOption(e.target.value as PeriodOption)}>
          <option value="current_month">Mês atual</option>
          <option value="next_3">Próximos 3 meses</option>
          <option value="next_6">Próximos 6 meses</option>
          <option value="next_12">Próximos 12 meses</option>
          <option value="custom">Personalizado</option>
        </select>
        {periodOption === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      {singleCardAccount && invoice && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Fatura do ciclo atual</div>
          <div className="card-subtitle">
            {invoice.cycle.start.toLocaleDateString('pt-BR')} – {invoice.cycle.end.toLocaleDateString('pt-BR')} · vencimento{' '}
            {invoice.cycle.dueDate.toLocaleDateString('pt-BR')}
          </div>
          <div className="amount expense" style={{ fontSize: '1.3em', marginTop: 6 }}>
            {formatCurrency(invoice.amount)}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Esse valor só afeta o fluxo de caixa de outra conta quando o pagamento da fatura for lançado como uma
            transação própria — despesas no cartão não debitam nenhuma outra conta automaticamente.
          </p>
        </div>
      )}

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : (
        <>
          <CashFlowLineChart data={chartData} showRealized={showRealized} showCombined={showCombined} />

          {willGoNegative && (
            <p className="error-text" style={{ marginTop: 8 }}>
              Atenção: o saldo projetado fica negativo em algum ponto do período selecionado.
            </p>
          )}

          {lastPoint && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-subtitle">Saldo ao final do período</div>
              {showRealized && (
                <div className="amount income">Realizado: {formatCurrency(lastPoint.realizedBalance)}</div>
              )}
              {showCombined && (
                <div className="amount income">
                  Realizado + projetado: {formatCurrency(lastPoint.combinedBalance)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
