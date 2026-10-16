/**
 * The salary band drawing (its own chunk, F22; see charts/lazy.ts).
 *
 * Each grade's range on one shared scale, with its midpoint marked. The
 * positions are worked out by the caller and arrive as percentages: money is
 * never done in arithmetic here (gate 20, it is a decimal string on the wire).
 *
 * The three runtime values are CSS variables the classes read, as every other
 * measured bar in the package does, so no length or colour is written inline.
 */
import type { CSSProperties } from "react";
import { seriesInk, type Series } from "./lazy";

export interface BandDrawProps {
  from: number;
  to: number;
  middle: number;
  series: Series;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

export default function BandDraw({ from, to, middle, series }: BandDrawProps) {
  const left = clamp(from);
  const right = Math.max(left, clamp(to));
  const scale = {
    "--band-from": `${left}%`,
    "--band-span": `${right - left}%`,
    "--band-mid": `${clamp(middle)}%`,
    "--band-ink": seriesInk(series),
  } as CSSProperties;

  return (
    <span className="relative block h-6 w-full rounded-box bg-muted" style={scale} aria-hidden="true">
      <span className="absolute inset-y-0 left-(--band-from) w-(--band-span) rounded-box bg-(--band-ink) opacity-25" />
      <span className="absolute inset-y-1 left-(--band-mid) w-0.5 rounded-sm bg-(--band-ink)" />
    </span>
  );
}
