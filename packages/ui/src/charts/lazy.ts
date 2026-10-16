/**
 * How a heavy part is loaded (F22): the drawing lives in a `*.draw.tsx` of its
 * own, so the bundler gives it its own chunk and only a screen that shows a
 * chart ever downloads it. The component beside it is the boundary: it holds
 * the props, the card, the caption and the accessible name, and suspends on
 * the drawing with a placeholder the size the chart will be.
 *
 * `*.draw.tsx` is not a catalogue entry (scripts/gen/components.js skips it);
 * the component that loads it is documented instead.
 */
import { lazy, type ComponentType } from "react";

/** How tall a chart's card is, so its placeholder does not make the page jump. */
export const CHART_HEIGHT = "h-40";

/** The chart series, in the order a chart with no colour of its own uses them. */
export const SERIES = [1, 2, 3, 4, 5, 6] as const;

/** One of the six chart series (MILESTONES §5.2: a light set and a dark set, both in tokens.css). */
export type Series = (typeof SERIES)[number];

/**
 * The CSS variable of a series. The value comes from tokens.css, so the light
 * and the dark palette are both read without a chart knowing which theme is on.
 */
export const seriesInk = (series: Series) => `var(--chart-${series})`;

/** Wraps a drawing module's default export so React can suspend on it. */
export function lazyDraw<P>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(load);
}
