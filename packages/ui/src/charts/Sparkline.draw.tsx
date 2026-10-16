/**
 * The sparkline's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * A bare line with no axes, sized by the box around it, for a trend inside a
 * table cell or beside a KPI's number.
 */
import { seriesInk, type Series } from "./lazy";

export interface SparkDrawProps {
  values: number[];
  series: Series;
}

const W = 100;
const H = 28;
const PAD = 3;

export default function SparkDraw({ values, series }: SparkDrawProps) {
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const span = highest - lowest || 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(H - PAD - ((v - lowest) / span) * (H - PAD * 2)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden="true" focusable="false">
      <polyline points={points.join(" ")} fill="none" stroke={seriesInk(series)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
