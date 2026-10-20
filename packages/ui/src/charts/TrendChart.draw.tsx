/**
 * The trend chart's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * SVG stretched to the card (preserveAspectRatio none) with strokes that do not scale, so
 * a line is the same weight on a laptop and a wide monitor and the figures beside it stay
 * HTML text at their own size. A null is a gap in the line, never a drop to zero: a minute
 * nobody recorded is not a quiet minute.
 */
import { seriesInk, type Series } from "./lazy";

export interface TrendDrawLine {
  values: (number | null)[];
  series: Series;
}

export interface TrendDrawProps {
  lines: TrendDrawLine[];
  /** How many points across. */
  count: number;
  /** The top of the scale; the bottom is zero. */
  top: number;
  /** A dashed line across at this value. */
  target?: number;
  /** The point the pointer is over, drawn as a rule. */
  at: number | null;
  /** Told which point the pointer is over, or null when it leaves. */
  onAt: (index: number | null) => void;
}

const W = 600;
const H = 160;
const PAD = 6;

export default function TrendDraw({ lines, count, top, target, at, onAt }: TrendDrawProps) {
  const x = (i: number) => (count > 1 ? (i * W) / (count - 1) : W / 2);
  const y = (v: number) => H - PAD - (Math.max(0, Math.min(v, top)) / top) * (H - 2 * PAD);

  /** Each unbroken run of a line, as one path; a lone point is a short stroke so it still shows. */
  const paths = (values: (number | null)[]) => {
    const out: string[] = [];
    let run: string[] = [];
    const close = () => {
      if (run.length === 1) out.push(`${run[0]} h 0.01`);
      else if (run.length > 1) out.push(run.join(" "));
      run = [];
    };
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return close();
      run.push(`${run.length ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    });
    close();
    return out;
  };

  const pointAt = (clientX: number, rect: DOMRect) => {
    if (count < 1 || rect.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (count - 1));
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-40 w-full touch-pan-y"
      aria-hidden="true"
      focusable="false"
      onPointerMove={(e) => onAt(pointAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => onAt(null)}
    >
      {[0, 0.5, 1].map((part) => (
        <line key={part} x1="0" x2={W} y1={y(top * part)} y2={y(top * part)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {target !== undefined && (
        <line
          data-target=""
          x1="0"
          x2={W}
          y1={y(target)}
          y2={y(target)}
          stroke="var(--destructive)"
          strokeWidth="1.5"
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {lines.map((line, n) =>
        paths(line.values).map((d, k) => (
          <path
            key={`${n}-${k}`}
            d={d}
            fill="none"
            stroke={seriesInk(line.series)}
            strokeWidth="2.25"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {at !== null && (
        <line data-rule="" x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="var(--muted-foreground)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
