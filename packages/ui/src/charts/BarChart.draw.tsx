/**
 * The bar chart's drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * Bars on a shared scale, each in its own series token or all in one, so a
 * comparison reads the same in both themes (MILESTONES §5.2). It is drawn in
 * the card's own pixels at the chart's height, so a label stays 11 px on a
 * laptop and a wide monitor alike, and none runs past the card's edge. Up to
 * twelve bars every label shows, and a card too narrow for them scrolls the
 * drawing inside it. Past twelve (a month of days) a label that would touch the
 * one before it is left off, never the first or the last; the frame still reads
 * every bar out.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import { CHART_HEIGHT, seriesInk, type Series } from "./lazy";

export interface BarDrawProps {
  bars: Array<{ label: string; value: number; series?: Series }>;
  series: Series;
  perBar: boolean;
}

/** Up to this many bars, every label shows; past it, labels that would touch are left off. */
export const EVERY_LABEL_UP_TO = 12;

/** The size drawn before the card is measured: the first frame, or a test with no layout. */
const FALLBACK = { width: 640, height: 160 };
/** The narrowest the drawing gets before its card scrolls it. */
const NARROWEST = 320;
const TOP = 8;
/** The strip under the bars that holds the labels. */
const STRIP = 20;
/** The labels' size: text-2xs, as the other charts' axes. */
const LABEL_PX = 11;

/** Geist's advance at 1 em, rounded up, by kind of character: figures, capitals, small letters, the rest. */
const advance = (ch: string) => (/[0-9]/.test(ch) ? 0.65 : /[A-Z]/.test(ch) ? 0.75 : /[a-z]/.test(ch) ? 0.56 : 0.4);

/** A label's width at 11 px, with 4 px clear on each side. */
export const labelRoom = (label: string) => [...label].reduce((w, ch) => w + advance(ch) * LABEL_PX, 0) + 8;

/**
 * Where each bar's label is centred across a drawing `width` wide, or null where it
 * is left off. Every label shows when there is room; otherwise every nth, from the
 * first, n wide enough for the widest label and for the first and last being pulled
 * in from the edges. The last bar's label always shows, the one before it giving way.
 */
export function labelSpots(labels: string[], width: number): Array<number | null> {
  const count = labels.length;
  const slot = width / Math.max(count, 1);
  const widest = Math.max(0, ...labels.map(labelRoom));
  const pull = Math.max(0, widest / 2 - slot / 2);
  const step = Math.max(1, Math.ceil((widest + pull) / slot - 1e-6));
  const half = (i: number) => labelRoom(labels[i] ?? "") / 2;
  const centre = (i: number) => Math.min(Math.max(i * slot + slot / 2, half(i)), Math.max(half(i), width - half(i)));
  const kept: number[] = [];
  for (let i = 0; i < count; i += step) kept.push(i);
  const last = count - 1;
  if (count && kept[kept.length - 1] !== last) {
    const touches = (i: number) => centre(last) - half(last) < centre(i) + half(i);
    while (kept.length > 1 && touches(kept[kept.length - 1]!)) kept.pop();
    kept.push(last);
  }
  const spots: Array<number | null> = labels.map(() => null);
  for (const i of kept) spots[i] = centre(i);
  return spots;
}

/** How wide the drawing must be for every label to show: each bar as wide as the widest label. */
export const widthForLabels = (labels: string[]) =>
  labels.length > EVERY_LABEL_UP_TO ? NARROWEST : Math.max(NARROWEST, Math.ceil(labels.length * Math.max(0, ...labels.map(labelRoom))));

/** The drawing's size in CSS pixels, followed as the card resizes. */
function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = box;
      // Hidden (a desktop-only chart on a phone) or not laid out: keep what is drawn.
      if (width > 0 && height > 0) setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  return { ref, ...size };
}

export default function BarDraw({ bars, series, perBar }: BarDrawProps) {
  const { ref, width, height } = useSize();
  const labels = bars.map((b) => b.label);
  const floor = height - STRIP;
  const highest = Math.max(0, ...bars.map((b) => b.value)) || 1;
  const slot = width / Math.max(bars.length, 1);
  const barWidth = Math.min(slot * 0.62, 56);
  const spots = labelSpots(labels, width);

  return (
    <div
      ref={ref}
      /* The one runtime value is the narrowest the drawing may get, as a CSS variable the class reads. */
      style={{ "--bars-min": `${widthForLabels(labels)}px` } as CSSProperties}
      className={cn(CHART_HEIGHT, "min-w-(--bars-min)")}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="block size-full" aria-hidden="true" focusable="false">
        <line x1="0" x2={width} y1={floor} y2={floor} stroke="var(--border)" strokeWidth="1" />
        {bars.map((bar, i) => {
          const tall = Math.max((Math.max(bar.value, 0) / highest) * (floor - TOP), bar.value > 0 ? 2 : 0);
          const x = i * slot + (slot - barWidth) / 2;
          const spot = spots[i];
          return (
            <g key={i}>
              <rect
                x={x}
                y={floor - tall}
                width={barWidth}
                height={tall}
                rx={Math.min(4, barWidth / 2)}
                fill={seriesInk(bar.series ?? (perBar ? (((i % 6) + 1) as Series) : series))}
              >
                <title>{`${bar.label} ${bar.value}`}</title>
              </rect>
              {spot != null && (
                <text x={spot} y={height - 6} textAnchor="middle" fontSize={LABEL_PX} className="tabular-nums" fill="var(--subtle-foreground)">
                  {bar.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
