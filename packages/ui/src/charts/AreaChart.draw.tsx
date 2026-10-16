/**
 * The area chart's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * SVG on a viewBox, so it is crisp at any size and needs no chart library. The
 * line, the fill and the points are one series' token, which is a different
 * value in each theme (MILESTONES §5.2), so the chart is legible in both
 * without knowing which is on.
 */
import { seriesInk, type Series } from "./lazy";

export interface AreaDrawProps {
  values: number[];
  labels: string[];
  series: Series;
  /** Draws the grid lines and the top figure; off for a sparkline-like strip. */
  grid: boolean;
}

const W = 640;
const H = 150;
const TOP = 16;
const FLOOR = H - 12;

export default function AreaDraw({ values, labels, series, grid }: AreaDrawProps) {
  const ink = seriesInk(series);
  const highest = Math.max(...values, 1);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const y = (v: number) => (FLOOR - (v / highest) * (FLOOR - TOP)).toFixed(1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-80" aria-hidden="true" focusable="false">
      {grid &&
        [0.25, 0.5, 0.75, 1].map((part) => (
          <line key={part} x1="0" x2={W} y1={y(highest * part)} y2={y(highest * part)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
        ))}
      <polygon points={`0,${FLOOR} ${points.join(" ")} ${W},${FLOOR}`} fill={ink} opacity=".12" />
      <polyline points={points.join(" ")} fill="none" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={(i * step).toFixed(1)} cy={y(v)} r="3" fill={ink}>
          <title>{`${labels[i] ?? ""} ${v}`.trim()}</title>
        </circle>
      ))}
    </svg>
  );
}
