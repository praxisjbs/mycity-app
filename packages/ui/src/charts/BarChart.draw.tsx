/**
 * The bar chart's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * Bars on a shared scale, each in its own series token or all in one, so a
 * comparison reads the same in both themes (MILESTONES §5.2).
 */
import { seriesInk, type Series } from "./lazy";

export interface BarDrawProps {
  bars: Array<{ label: string; value: number; series?: Series }>;
  series: Series;
  perBar: boolean;
}

const W = 640;
const H = 150;
const TOP = 16;
const FLOOR = H - 22;

export default function BarDraw({ bars, series, perBar }: BarDrawProps) {
  const highest = Math.max(...bars.map((b) => b.value), 1);
  const slot = W / Math.max(bars.length, 1);
  const width = Math.min(slot * 0.62, 56);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-80" aria-hidden="true" focusable="false">
      <line x1="0" x2={W} y1={FLOOR} y2={FLOOR} stroke="var(--border)" strokeWidth="1" />
      {bars.map((bar, i) => {
        const height = Math.max((bar.value / highest) * (FLOOR - TOP), bar.value > 0 ? 2 : 0);
        const x = i * slot + (slot - width) / 2;
        return (
          <g key={bar.label}>
            <rect x={x} y={FLOOR - height} width={width} height={height} rx="4" fill={seriesInk(bar.series ?? (perBar ? ((i % 6) + 1) as Series : series))}>
              <title>{`${bar.label} ${bar.value}`}</title>
            </rect>
            <text x={x + width / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--subtle-foreground)">
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
