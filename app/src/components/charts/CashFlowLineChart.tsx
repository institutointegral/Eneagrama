import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePrefersDark } from '../../hooks/usePrefersDark';
import { chromeColor, statusColor } from '../../lib/chartColors';
import type { CashFlowPoint } from '../../lib/cashFlow';

interface Props {
  data: CashFlowPoint[];
  showRealized: boolean;
  showCombined: boolean;
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// The cascading balance over time. A zero reference line makes it obvious the
// moment the projection dips below zero ("vai faltar dinheiro"). Realized is
// the "good/confirmed" line; the combined (realized+projected) line is the
// same hue's muted/dashed-less variant so it still reads as "the same
// balance, extended" rather than a competing series.
export function CashFlowLineChart({ data, showRealized, showCombined }: Props) {
  const dark = usePrefersDark();
  const gridline = chromeColor('gridline', dark);
  const axisColor = chromeColor('mutedText', dark);
  const realizedColor = statusColor('good', dark);
  const combinedColor = '#2a78d6';

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={gridline} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: axisColor }} axisLine={{ stroke: gridline }} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} width={56} />
        <Tooltip formatter={(value) => formatCurrency(Number(Array.isArray(value) ? value[0] : value))} contentStyle={{ fontSize: 13 }} />
        {(showRealized && showCombined) && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <ReferenceLine y={0} stroke={statusColor('critical', dark)} strokeDasharray="4 4" />
        {showRealized && (
          <Line
            type="monotone"
            dataKey="realizedBalance"
            name="Realizado"
            stroke={realizedColor}
            strokeWidth={2}
            dot={{ r: 4, fill: realizedColor, stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        )}
        {showCombined && (
          <Line
            type="monotone"
            dataKey="combinedBalance"
            name="Realizado + projetado"
            stroke={combinedColor}
            strokeWidth={2}
            strokeDasharray={showRealized ? '6 3' : undefined}
            dot={{ r: 4, fill: combinedColor, stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
