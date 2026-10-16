/**
 * The donut's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * One ring, with the figure in the middle. The track is the border token and
 * the ring a series token, so both themes hold their contrast
 * (MILESTONES §5.2: City Green is invisible on the dark card).
 */
import { seriesInk, type Series } from "./lazy";

export interface DonutDrawProps {
  slices: Array<{ label: string; value: number; series?: Series }>;
  percent: number;
  middle: string;
  under: string;
  series: Series;
}

const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function DonutDraw({ slices, percent, middle, under, series }: DonutDrawProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let turned = 0;

  return (
    <svg viewBox="0 0 110 110" className="size-28 flex-none" aria-hidden="true" focusable="false">
      <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border)" strokeWidth="13" />
      {slices.length > 0 && total > 0
        ? slices.map((slice, i) => {
            const length = (CIRCUMFERENCE * slice.value) / total;
            const offset = turned;
            turned += length;
            return (
              <circle
                key={slice.label}
                cx="55"
                cy="55"
                r={R}
                fill="none"
                stroke={seriesInk(slice.series ?? (((i % 6) + 1) as Series))}
                strokeWidth="13"
                strokeDasharray={`${length.toFixed(1)} ${(CIRCUMFERENCE - length).toFixed(1)}`}
                strokeDashoffset={(-offset).toFixed(1)}
                transform="rotate(-90 55 55)"
              >
                <title>{`${slice.label} ${slice.value}`}</title>
              </circle>
            );
          })
        : null}
      {slices.length === 0 && (
        <circle
          cx="55"
          cy="55"
          r={R}
          fill="none"
          stroke={seriesInk(series)}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${((CIRCUMFERENCE * Math.max(0, Math.min(100, percent))) / 100).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`}
          transform="rotate(-90 55 55)"
        />
      )}
      <text x="55" y="53" textAnchor="middle" fontSize="21" fontWeight="700" fill="var(--foreground)">
        {middle}
      </text>
      {under && (
        <text x="55" y="68" textAnchor="middle" fontSize="9" fill="var(--subtle-foreground)">
          {under}
        </text>
      )}
    </svg>
  );
}
