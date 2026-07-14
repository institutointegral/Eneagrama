import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePrefersDark } from '../../hooks/usePrefersDark';
import { categoricalPalette, chromeColor } from '../../lib/chartColors';

export interface CategoryBreakdownDatum {
  id: string;
  name: string;
  value: number;
  hasChildren?: boolean;
}

interface Props {
  data: CategoryBreakdownDatum[];
  onBarClick?: (id: string) => void;
  formatValue?: (value: number) => string;
}

function defaultFormat(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Part-to-whole spend by category as a horizontal bar chart (per the dataviz
// skill: bars over a pie for more than a couple of slices / long category
// names). Each bar is directly labeled with its category name on the axis,
// which is also the "relief" mitigation for the categorical palette slots
// that fall under 3:1 contrast on the light surface.
export function CategoryBreakdownChart({ data, onBarClick, formatValue = defaultFormat }: Props) {
  const dark = usePrefersDark();
  const palette = categoricalPalette(dark);
  const gridline = chromeColor('gridline', dark);
  const axisColor = chromeColor('mutedText', dark);

  if (data.length === 0) {
    return <p className="muted">Sem gastos no período selecionado.</p>;
  }

  const sorted = [...data].sort((a, b) => b.value - a.value);
  const height = Math.max(120, sorted.length * 36 + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
        barSize={20}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 12, fill: axisColor }}
          axisLine={{ stroke: gridline }}
          tickLine={false}
        />
        <Tooltip
          formatter={(value) => formatValue(Number(Array.isArray(value) ? value[0] : value))}
          contentStyle={{ fontSize: 13 }}
          cursor={{ fill: gridline, opacity: 0.4 }}
        />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          onClick={(entry) => onBarClick?.((entry as unknown as CategoryBreakdownDatum).id)}
          cursor={onBarClick ? 'pointer' : undefined}
        >
          {sorted.map((entry, i) => (
            <Cell key={entry.id} fill={palette[i % palette.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
