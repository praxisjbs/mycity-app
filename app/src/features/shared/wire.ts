import type { BarsRow, KpiTrend, Series, TimelineItem } from "@mycity/ui";

/**
 * What the API sends, turned into what the shared components take. The wire's
 * vocabulary is the API's and the components' is their own, so the mapping is
 * written once here rather than guessed at every call site.
 */

/** A labelled bar as every module's reads send one. */
export interface WireBar {
  label: string;
  pct: number;
  value: string;
  /** "warn" draws the bar in the warning series, "brand" in the yellow one. */
  emphasis?: "warn" | "brand" | null;
}

/** Which chart series an emphasis takes (MILESTONES §5.2: both themes from the tokens). */
const SERIES: Record<string, Series> = { warn: 4, brand: 2 };

/** `Bars` rows from the wire's. */
export const toBars = (rows: WireBar[]): BarsRow[] =>
  rows.map((row) => ({
    label: row.label,
    percent: row.pct,
    value: row.value,
    ...(row.emphasis && SERIES[row.emphasis] ? { series: SERIES[row.emphasis] } : {}),
  }));

/** An event on a record's trail as every module's reads send one. */
export interface WireTrailItem {
  title: string;
  when: string;
  text?: string | null;
  /** "hi" is the step in hand, "ok" is finished. */
  tone?: "hi" | "ok" | null;
}

/** `Timeline` items from the wire's: "hi" is where it waits, "ok" is behind us. */
export const toTrail = (items: WireTrailItem[]): TimelineItem[] =>
  items.map((item) => ({
    title: item.title,
    when: item.when,
    text: item.text ?? undefined,
    tone: item.tone === "hi" ? "now" : item.tone === "ok" ? "done" : undefined,
  }));

/** Which way a KPI's figure has moved, as the wire says it. */
export type WireTrendDir = "up" | "dn" | "fl";

/** `KpiCard`'s trend from the wire's direction; nothing when the read sent none. */
export const toTrend = (dir?: WireTrendDir | null): KpiTrend | undefined =>
  dir === "up" ? "up" : dir === "dn" ? "down" : dir === "fl" ? "flat" : undefined;
