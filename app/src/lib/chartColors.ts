// Palette validated with the dataviz skill's scripts/validate_palette.js
// (CVD separation + contrast checks pass for both light and dark surfaces).
// Category identity always ships with a direct text label alongside the
// color, per the skill's "relief rule" for the slots that fall under 3:1
// contrast on the light surface (aqua, yellow, magenta).
export const CATEGORICAL_LIGHT = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];

export const CATEGORICAL_DARK = [
  '#3987e5',
  '#199e70',
  '#c98500',
  '#008300',
  '#9085e9',
  '#e66767',
  '#d55181',
  '#d95926',
];

export const STATUS_COLORS = {
  good: { light: '#0ca30c', dark: '#0ca30c' },
  warning: { light: '#fab219', dark: '#fab219' },
  critical: { light: '#d03b3b', dark: '#d03b3b' },
};

export const CHART_CHROME = {
  gridline: { light: '#e1e0d9', dark: '#2c2c2a' },
  axis: { light: '#c3c2b7', dark: '#383835' },
  mutedText: { light: '#898781', dark: '#898781' },
};


export function categoricalPalette(dark: boolean): string[] {
  return dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}

export function statusColor(role: keyof typeof STATUS_COLORS, dark: boolean): string {
  return STATUS_COLORS[role][dark ? 'dark' : 'light'];
}

export function chromeColor(role: keyof typeof CHART_CHROME, dark: boolean): string {
  return CHART_CHROME[role][dark ? 'dark' : 'light'];
}
