/**
 * @component OverviewPane
 * @group Assistant
 * @summary The pane's Overview: up to three figures and one chart the server drew from a summary read (a bar, a stacked bar with its key, a line or a ring); nothing until a question reads a summary.
 * @use In PaneTabs' overview slot with the answer's `overview` (AiAnswer.overview); the tab is disabled while it is null. The figures and the chart come from the server (docs/guides/praxis-ai.md §6.13; the summary reads land with PR3 of the Praxis AI Engine).
 * @avoid Figures a screen worked out itself; a dashboard (Home's KpiGrid and its charts); a table (TablePane).
 * @phone The figures two to a row, the chart below, inside the pane sheet; no chart caption.
 * @a11y The figures are KpiCards (a named figure each); the chart is one of the shared charts, read out as a list of label and figure, a stacked bar as each part and its total.
 * @status beta
 * @example <OverviewPane overview={answer.overview} />
 */
import { cn } from "../lib/cn";
import { formatMoney, formatNumber } from "../lib/format";
import { EmptyState } from "../display/EmptyState";
import { KpiCard } from "../display/KpiCard";
import { KpiGrid } from "../display/KpiGrid";
import { BarChart } from "../charts/BarChart";
import { DonutChart } from "../charts/DonutChart";
import { TrendChart } from "../charts/TrendChart";
import type { PaneChart, PaneFigure, PaneOverview } from "./pane";

export interface OverviewPaneProps {
  /** The Overview the answer carried, or null when no summary read answered. */
  overview: PaneOverview | null;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A figure as a person reads it, by its unit: naira with kobo, a per cent, a count, days or minutes. */
export function figureText(f: Pick<PaneFigure, "value" | "unit">): string {
  const v = f.value;
  if (f.unit === "ngn") return formatMoney(typeof v === "number" ? v.toFixed(2) : v);
  if (f.unit === "percent") return formatNumber(v, "%");
  if (f.unit === "days" || f.unit === "minutes") return formatNumber(v, f.unit);
  return formatNumber(v);
}

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

/** A stacked bar's part as drawn: a missing, negative or broken figure counts as 0. */
const partOf = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The chart's name: its first series' label, which is the summary's own grouping (Title Case, short). */
const nameOf = (c: PaneChart) => c.series[0]?.label ?? "Overview";

function Chart({ chart }: { chart: PaneChart }) {
  const first = chart.series[0];
  if (!first) return null;
  if (chart.kind === "line") {
    return <TrendChart title={nameOf(chart)} labels={chart.labels} lines={chart.series.slice(0, 3).map((s) => ({ name: s.label, values: s.values.map((v) => (Number.isFinite(v) ? v : null)) }))} />;
  }
  if (chart.kind === "donut") {
    const slices = chart.labels.map((label, i) => ({ label, value: first.values[i] ?? 0 }));
    return <DonutChart title={nameOf(chart)} middle={formatNumber(sum(first.values))} under="in all" slices={slices} />;
  }
  if (chart.kind === "stacked_bar") {
    // One series per part, in order, the key naming each; a bar's total is the sum of its parts.
    const parts = chart.series.slice(0, 6);
    const bars = chart.labels.map((label, i) => {
      const values = parts.map((s) => partOf(s.values[i]));
      return { label, value: sum(values), parts: values };
    });
    return <BarChart label={chart.title} parts={parts.map((s) => s.label)} bars={bars} format={(v) => formatNumber(v)} />;
  }
  // A bar draws its first series.
  return <BarChart title={nameOf(chart)} bars={chart.labels.map((label, i) => ({ label, value: first.values[i] ?? 0 }))} colourPerBar={chart.labels.length <= 6} format={(v) => formatNumber(v)} />;
}

export function OverviewPane({ overview, className }: OverviewPaneProps) {
  if (!overview || (!overview.figures.length && !overview.chart)) return <EmptyState bare title="No Figures Yet" className={className} />;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {overview.title && (
        <p data-copy="content" className="text-sm text-muted-foreground">
          {overview.title}
        </p>
      )}
      {overview.figures.length > 0 && (
        <KpiGrid cols={overview.figures.length >= 3 ? 3 : 2}>
          {overview.figures.map((f) => (
            <KpiCard key={f.key} title={<span data-copy="content">{f.label}</span>} value={figureText(f)} />
          ))}
        </KpiGrid>
      )}
      {overview.chart && (
        <div className="flex flex-col gap-1.5">
          <p data-copy="content" className="text-sm">
            {overview.chart.title}
          </p>
          <Chart chart={overview.chart} />
        </div>
      )}
    </div>
  );
}
