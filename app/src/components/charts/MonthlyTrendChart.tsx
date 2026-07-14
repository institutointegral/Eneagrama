import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePrefersDark } from '../../hooks/usePrefersDark';
import { chromeColor, statusColor } from '../../lib/chartColors';

export interface MonthlyTrendDatum {
  month: string;
  label: string;
  income: number;
  expense: number;
}

interface Props {
  data: MonthlyTrendDatum[];
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Receita vs despesa realizadas, mês a mês. Single Y axis (never dual-axis —
// both series are the same unit). Income/expense read as a fixed status pair
// (good/critical), not arbitrary categorical identity, so they always use
// the same two colors regardless of how many other series exist elsewhere.
export function MonthlyTrendChart({ data }: Props) {
  const dark = usePrefersDark();
  const gridline = chromeColor('gridline', dark);
  const axisColor = chromeColor('mutedText', dark);
  const incomeColor = statusColor('good', dark);
  const expenseColor = statusColor('critical', dark);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={gridline} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: axisColor }} axisLine={{ stroke: gridline }} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(value) => formatCurrency(Number(Array.isArray(value) ? value[0] : value))} contentStyle={{ fontSize: 13 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="income"
          name="Receita"
          stroke={incomeColor}
          strokeWidth={2}
          dot={{ r: 4, fill: incomeColor, stroke: 'var(--surface)', strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="expense"
          name="Despesa"
          stroke={expenseColor}
          strokeWidth={2}
          dot={{ r: 4, fill: expenseColor, stroke: 'var(--surface)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
