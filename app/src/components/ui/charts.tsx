import type { ReactNode } from "react";
import { Card, CardHeader } from "@mycity/ui";

/**
 * The prototype's two chart forms, drawn as SVG: no chart library. Colours are
 * the chart tokens, which change with the theme (gate 14: legible in both).
 */
export function AreaChart({ title, values, labels, note, right }: { title: ReactNode; values: number[]; labels?: string[]; note?: ReactNode; right?: ReactNode }) {
  const w = 640;
  const h = 150;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v: number) => (h - 10 - (v / max) * (h - 34)).toFixed(1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`);
  return (
    <Card>
      <CardHeader title={title} right={right} />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full min-w-[380px]" role="img" aria-label={typeof title === "string" ? title : "Chart"}>
          <polygon points={`0,${h - 10} ${pts.join(" ")} ${w},${h - 10}`} fill="var(--chart-1)" opacity=".12" />
          <polyline points={pts.join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinejoin="round" />
          {values.map((v, i) => (
            <circle key={i} cx={(i * step).toFixed(1)} cy={y(v)} r="3" fill="var(--chart-1)">
              <title>{`${labels?.[i] ?? ""} ${v}`.trim()}</title>
            </circle>
          ))}
        </svg>
      </div>
      {note && <p className="mt-2 text-[11.5px] text-subtle-foreground">{note}</p>}
    </Card>
  );
}

/** A ring showing one percentage, with a line of text beside it. */
export function Donut({ pct, label, text }: { pct: number; label: string; text: ReactNode }) {
  const c = 2 * Math.PI * 42;
  return (
    <Card className="flex flex-wrap items-center gap-[18px]">
      <svg viewBox="0 0 110 110" className="size-28 flex-none" role="img" aria-label={`${pct}% ${label}`}>
        <circle cx="55" cy="55" r="42" fill="none" stroke="var(--border)" strokeWidth="13" />
        <circle cx="55" cy="55" r="42" fill="none" stroke="var(--chart-1)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 55 55)" />
        <text x="55" y="52" textAnchor="middle" fontSize="23" fontWeight="700" fill="var(--foreground)" letterSpacing="-1">
          {pct}%
        </text>
        <text x="55" y="68" textAnchor="middle" fontSize="9.5" fill="var(--subtle-foreground)">
          {label}
        </text>
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted-foreground">{text}</p>
      </div>
    </Card>
  );
}

/**
 * Salary bands: each grade's range on one scale, with its midpoint marked.
 * Amounts arrive as strings; positions are display only, never money arithmetic.
 */
export function Bands({ title, scaleLabel, rows, note }: {
  title: ReactNode;
  scaleLabel: string;
  rows: Array<{ label: ReactNode; sub?: ReactNode; minPct: number; maxPct: number; midPct: number; value: ReactNode }>;
  note?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} right={<span className="text-[11.5px] text-subtle-foreground">{scaleLabel}</span>} />
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 py-[7px]">
          <span className="w-[124px] flex-none text-[12.5px] leading-[1.3] font-semibold max-md:w-[86px]">
            {r.label}
            {r.sub && <em className="block text-[10.5px] font-medium text-subtle-foreground not-italic">{r.sub}</em>}
          </span>
          <span className="relative h-[26px] min-w-0 flex-1 rounded-[7px] bg-muted">
            <i className="absolute inset-y-0 rounded-[7px] opacity-[.22]" style={{ left: `${r.minPct}%`, width: `${r.maxPct - r.minPct}%`, background: "var(--chart-1)" }} />
            <b className="absolute inset-y-[3px] w-[3px] rounded-sm" style={{ left: `${r.midPct}%`, background: "var(--chart-1)" }} />
          </span>
          <span className="w-[124px] flex-none text-right text-[11.5px] font-semibold text-muted-foreground max-md:w-24">{r.value}</span>
        </div>
      ))}
      {note && <p className="mt-[11px] border-t border-dashed border-border pt-2.5 text-[11.5px] text-subtle-foreground">{note}</p>}
    </Card>
  );
}
