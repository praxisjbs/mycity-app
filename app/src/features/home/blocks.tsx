import type { ReactNode } from "react";
import type { BarRow, HomeBlock, KpiCell } from "@/api/types/home";
import { Bars, Kpi, StatStrip, Timeline } from "@/components/ui/data";
import { AreaChart, Donut } from "@/components/ui/charts";
import { Table } from "@/components/ui/Table";
import { formatDate, Meter, Pill, Who, Card, CardHeader, Grid, Money, HelpTerm } from "@mycity/ui";
import { useRouter } from "@/lib/router";
import { useKpiDetail } from "./KpiDetail";

const barColor = (b: BarRow) => (b.emphasis === "warn" ? "var(--chart-4)" : b.emphasis === "brand" ? "var(--primary)" : undefined);
export const toBars = (rows: BarRow[]) => rows.map((r) => ({ label: r.label, pct: r.pct, value: r.value, color: barColor(r) }));

/** A card with a title and an optional ⓘ, the common frame of Home's blocks. */
export function InfoCard({ title, info, right, children }: { title: string; info?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={info ? <HelpTerm help={info}>{title}</HelpTerm> : title} right={right} />
      {children}
    </Card>
  );
}

/** KPI tiles; each opens the records behind its number. */
export function KpiRow({ items, mobileCols = 1 }: { mobileCols?: 1 | 2; items: Array<{ key: string; label: string; value: string; tone?: "ok" | "warn" | "err" | "info" | "neutral"; trend?: { text: string; dir: "up" | "dn" | "fl" } }> }) {
  const open = useKpiDetail();
  return (
    <Grid cols={mobileCols === 2 ? "4m2" : 4}>
      {items.map((k) => (
        <Kpi key={k.key} label={k.label} value={k.value} tone={k.tone} trend={k.trend?.text} trendDir={k.trend?.dir} onClick={() => open(k.key, k.label)} />
      ))}
    </Grid>
  );
}

const KIND = { diary: ["info", "Diary"], task: ["warn", "Task"], note: ["neutral", "Note"] } as const;

export function Block({ block }: { block: HomeBlock }) {
  const { navigate } = useRouter();
  switch (block.type) {
    case "kpis":
      return <KpiRow items={block.items} />;
    case "statstrip":
      return <StatStrip items={block.items} />;
    case "split":
      return (
        <Grid cols={block.cols === "2" ? 2 : "1.4/1"}>
          {block.blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </Grid>
      );
    case "area":
      return <AreaChart title={block.title} values={block.values} labels={block.labels} note={block.note} />;
    case "donut":
      return <Donut pct={block.pct} label={block.label} text={block.text} />;
    case "bars":
      return (
        <div className="mb-3 last:mb-0 [.grid_&]:mb-0">
          <InfoCard title={block.title} info={block.info}>
            <Bars rows={toBars(block.rows)} note={block.note} />
          </InfoCard>
        </div>
      );
    case "need_you":
      return (
        <Table
          title={block.title}
          right={<Pill tone={block.badge.tone}>{block.badge.text}</Pill>}
          rows={block.rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(r.link)}
          empty={{ title: "Nothing needs you", text: "Requests waiting on you appear here." }}
          columns={
            block.variant === "requests"
              ? [
                  { key: "t", label: "Request", render: (r) => r.title },
                  { key: "f", label: "From", render: (r) => r.from && <Who name={r.from.display_name} sub={r.from.department} /> },
                  { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
                  { key: "s", label: "Stage", render: (r) => <Pill tone={r.stage.tone}>{r.stage.text}</Pill> },
                ]
              : [
                  { key: "t", label: "Partnership", render: (r) => r.title },
                  { key: "s", label: "Stage", render: (r) => <Pill tone={r.stage.tone}>{r.stage.text}</Pill> },
                  { key: "q", label: "Quiet", render: (r) => `${r.quiet_days} days` },
                  { key: "o", label: "Owner", desktop: true, render: (r) => r.from && <Who name={r.from.display_name} sub={r.from.department} /> },
                ]
          }
        />
      );
    case "activity":
      return (
        <Card>
          <CardHeader title={block.title} />
          <Timeline items={block.items.map((i) => ({ title: i.title, when: i.when, text: i.text, tone: i.tone }))} />
        </Card>
      );
    case "week":
      return (
        <Card>
          <CardHeader title={block.title} right={<span className="text-[11.5px] text-subtle-foreground">{block.range}</span>} />
          {block.days.map((d, i) => (
            <div key={i} className="flex items-center gap-[11px] border-b border-border py-2 last:border-b-0">
              <b className="w-[58px] flex-none text-[12px] text-subtle-foreground">{d.day}</b>
              <span className="min-w-0 flex-1 text-[12.5px]">{d.text}</span>
              <Pill tone={KIND[d.kind][0]}>{KIND[d.kind][1]}</Pill>
            </div>
          ))}
        </Card>
      );
    case "list":
      return (
        <InfoCard title={block.title} info={block.info}>
          {block.rows.map((r, i) => (
            <div key={i} className="flex items-center gap-[11px] border-b border-border py-2.5 last:border-b-0">
              <b className="w-[92px] flex-none text-[12px] text-subtle-foreground">{r.label}</b>
              <span className="flex-1 text-[12.5px]">{r.text}</span>
              <Pill tone={r.pill.tone}>{r.pill.text}</Pill>
            </div>
          ))}
        </InfoCard>
      );
    case "note":
      return <p className="mt-1 text-[11.5px] text-subtle-foreground">{block.text}</p>;
  }
}

/** One cell of a report model row. */
export function Cell({ cell }: { cell: KpiCell }) {
  switch (cell.kind) {
    case "text":
      return <>{cell.text}</>;
    case "person":
      return <Who name={cell.person.display_name} sub={cell.person.department} />;
    case "pill":
      return <Pill tone={cell.tone}>{cell.text}</Pill>;
    case "money":
      return <Money value={cell.amount} />;
    case "date":
      return <>{formatDate(cell.date)}</>;
    case "over":
      return <span className="inline-block rounded-full bg-warning-soft px-[9px] py-0.5 text-[11px] font-semibold whitespace-nowrap text-warning">{cell.text}</span>;
    case "bar":
      return <Meter pct={cell.pct} label={cell.text} />;
  }
}
