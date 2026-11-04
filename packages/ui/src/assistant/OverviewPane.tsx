/**
 * @component OverviewPane
 * @group Assistant
 * @summary The pane's Overview: up to three figures and one chart the server drew from a summary read; nothing until a question reads a summary.
 * @use In PaneTabs' overview slot with the answer's `overview` (AiAnswer.overview); the tab is disabled while it is null. The figures and the chart come from the server (docs/guides/praxis-ai.md §6.13; the summary reads land with PR3 of the Praxis AI Engine).
 * @avoid Figures a screen worked out itself; a dashboard (Home's KpiGrid and its charts); a table (TablePane).
 * @phone The figures two to a row, the chart below, inside the pane sheet; no chart caption.
 * @a11y The figures are KpiCards (a named figure each); the chart is one of the shared charts, read out as a list of label and figure.
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
  // A bar, or a stacked bar whose first series is drawn (the rest wait on PR3's own drawing).
  return <BarChart title={nameOf(chart)} bars={chart.labels.map((label, i) => ({ label, value: first.values[i] ?? 0 }))} colourPerBar={chart.labels.length <= 6} />;
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
