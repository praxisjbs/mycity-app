import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, Icon, type IconName, useIsMobile, Card } from "@mycity/ui";
import type { Tone } from "@/api/types/common";


const TREND = { up: "text-success", dn: "text-destructive", fl: "text-subtle-foreground" } as const;
const INK = { ok: "text-success", warn: "text-warning", err: "text-destructive", info: "text-info", neutral: "" } as const;

/**
 * KPI tile. With `onClick` it becomes a button that opens the detail behind
 * the number.
 *
 * `opensOn` says where the tile is clickable:
 * - "all" (default): desktop and phone. Use it when the modal is the only
 *   place that detail exists, e.g. Home's report model (docs/guides/home.md).
 * - "phone": the phone only. Use it when the desktop page already shows the
 *   detail beside the tiles (My Leave); on desktop the tile is plain, with no
 *   arrow, hover or click, so the screen is not cluttered with a second way
 *   to the same thing.
 */
export function Kpi({
  label, value, tone, trend, trendDir = "fl", onClick, opensOn = "all", className,
}: { label: ReactNode; value: ReactNode; tone?: Tone; trend?: ReactNode; trendDir?: keyof typeof TREND; onClick?: () => void; opensOn?: "all" | "phone"; className?: string }) {
  const mobile = useIsMobile();
  const click = opensOn === "phone" && !mobile ? undefined : onClick;
  const body = (
    <>
      <span className="text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <b className={cn("mt-0.5 block text-[25px] leading-[1.05] font-bold tracking-[-.028em] max-md:text-[21px]", tone && INK[tone])}>{value}</b>
      {trend && <span className={cn("mt-1.5 inline-flex items-center gap-[3px] text-[11.5px] font-[650]", TREND[trendDir])}>{trend}</span>}
    </>
  );
  if (!click) return <Card className={className}>{body}</Card>;
  return (
    <button
      type="button"
      onClick={click}
      className={cn(
        "relative block w-full max-w-full min-w-0 rounded-card border border-border bg-card p-[14px] text-left shadow-1 transition-[border-color,box-shadow] hover:border-subtle-foreground hover:shadow-2",
        className,
      )}
    >
      <span className="absolute top-[11px] right-[11px] text-subtle-foreground opacity-45">
        <Icon name="right" className="size-[15px]" />
      </span>
      {body}
    </button>
  );
}

/** A strip of labelled figures across the top of a record. Items marked `desktop` drop off on a phone. */
export function StatStrip({ items }: { items: Array<{ label: string; value: ReactNode; tone?: Tone; desktop?: boolean; onClick?: () => void; action?: string }> }) {
  return (
    <div className="mb-3 flex flex-wrap overflow-hidden rounded-card border border-border bg-card">
      {items.map((s, i) => {
        const inner = (
          <>
            <span className="text-[11px] font-semibold tracking-[.07em] text-subtle-foreground uppercase">{s.label}</span>
            <b className={cn("mt-[3px] block text-[17px] font-bold tracking-[-.02em]", s.tone && INK[s.tone])}>{s.value}</b>
            {s.action && <span className="mt-0.5 block text-[11.5px] font-semibold text-accent-foreground">{s.action}</span>}
          </>
        );
        const cls = cn(
          "min-w-[128px] flex-1 border-r border-border px-[14px] py-3 text-left last:border-r-0 max-md:min-w-[50%] max-md:border-b",
          s.desktop && "max-md:hidden",
        );
        return s.onClick ? (
          <button key={i} type="button" className={cn(cls, "hover:bg-accent")} onClick={s.onClick}>
            {inner}
          </button>
        ) : (
          <div key={i} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** Vertical timeline of events. `tone` marks the dot: hi is the yellow highlight. */
export function Timeline({ items }: { items: Array<{ title: ReactNode; when: ReactNode; text?: ReactNode; tone?: "hi" | "ok" }> }) {
  return (
    <div className="tl">
      {items.map((it, i) => (
        <div key={i} className={cn("tl-dot relative pb-[14px] last:pb-0", it.tone)}>
          <b className="block text-[12.5px] font-semibold">{it.title}</b>
          <span className="text-[11.5px] text-subtle-foreground">{it.when}</span>
          {it.text && <p className="mt-[3px] text-[12.5px] text-muted-foreground">{it.text}</p>}
        </div>
      ))}
    </div>
  );
}

/** Horizontal progress bars with a label and a value: pipeline stages, KPI progress. */
export function Bars({ rows, note }: { rows: Array<{ label: ReactNode; pct: number; value: ReactNode; color?: string }>; note?: ReactNode }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          <span className="w-[132px] flex-none text-[12.5px] font-semibold max-md:w-[104px]">{r.label}</span>
          <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
            <i className="block h-full rounded-md" style={{ width: `${Math.max(0, Math.min(100, r.pct))}%`, background: r.color ?? "var(--chart-1)" }} />
          </span>
          <span className="w-[76px] flex-none text-right text-[12px] font-[650]">{r.value}</span>
        </div>
      ))}
      {note && <p className="mt-[11px] border-t border-dashed border-border pt-2.5 text-[11.5px] text-subtle-foreground">{note}</p>}
    </>
  );
}

/** An approval or stage chain: done, the current step, and what is still to come. */
export function Chain({ steps }: { steps: Array<{ label: ReactNode; state?: "done" | "now" }> }) {
  return (
    <div className="flex flex-wrap items-center gap-y-1.5">
      {steps.map((s, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && (
            <span className="flex flex-none px-[5px] text-subtle-foreground">
              <Icon name="right" />
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-[11px] py-[5px] text-[12px] font-semibold",
              s.state === "done" && "border-transparent bg-success-soft text-success",
              s.state === "now" && "border-transparent bg-primary text-primary-foreground",
              !s.state && "border-border bg-muted text-subtle-foreground",
            )}
          >
            {s.state === "done" && <Icon name="ok" />}
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Small bordered tile with a heading and a line of text. */
export function Tile({ title, text, children, className }: { title: ReactNode; text?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-[14px]", className)}>
      <h4 className="mb-[5px] text-[13px]">{title}</h4>
      {text && <p className="text-[12px] text-muted-foreground">{text}</p>}
      {children && <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

/** Expandable question and answer. */
export function Accordion({ items }: { items: Array<{ title: ReactNode; body: ReactNode; open?: boolean }> }) {
  return (
    <>
      {items.map((a, i) => (
        <details key={i} open={a.open} className="plus-marker mb-2 overflow-hidden rounded-box border border-border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 px-[14px] py-[11px] text-[13px] font-semibold">{a.title}</summary>
          <div className="pr-[14px] pb-[13px] pl-[34px] text-[12.5px] text-muted-foreground">{a.body}</div>
        </details>
      ))}
    </>
  );
}

/** A big result card: the outcome of clocking in, a signature, a check. */
export function Result({ tone, label, title, text, icon }: { tone: "ok" | "warn" | "err" | "info"; label?: string; title: ReactNode; text?: ReactNode; icon?: IconName }) {
  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2.5 rounded-xl px-[13px] py-[11px]",
        tone === "ok" && "bg-success-soft text-success",
        tone === "warn" && "bg-warning-soft text-warning",
        tone === "err" && "bg-destructive-soft text-destructive",
        tone === "info" && "bg-info-soft text-info",
      )}
    >
      <Icon name={icon ?? (tone === "ok" ? "ok" : "alert")} size="m" className="mt-0.5" />
      <span>
        {label && <span className="block text-[10.5px] font-[650] tracking-[.09em] uppercase opacity-85">{label}</span>}
        <b className="block text-[15px] tracking-[-.01em]">{title}</b>
        {text && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{text}</p>}
      </span>
    </div>
  );
}

/** A stacked list of tappable rows (mobile lists that open a sheet). */
export function TapList({ items, flat }: { items: Array<{ key: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }>; flat?: boolean }) {
  return (
    <div className={cn("mb-3 flex flex-col overflow-hidden bg-card", flat ? "-mx-[14px] border-t border-border" : "rounded-card border border-border")}>
      {items.map((it) => (
        <button key={it.key} type="button" onClick={it.onClick} className="flex w-full items-center gap-2.5 border-b border-border px-[13px] py-3 text-left last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <b className="text-[13px] font-semibold">{it.title}</b>
            {it.sub && <span className="text-[11.5px] text-subtle-foreground">{it.sub}</span>}
          </span>
          {it.right}
          <Icon name="right" className="size-[15px] text-subtle-foreground" />
        </button>
      ))}
    </div>
  );
}

/** A small clickable link styled as text. */
export function TextLink({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("p-0 font-semibold text-accent-foreground underline underline-offset-2", className)} {...rest} />;
}

/** "Coming in M6" style card for a screen whose module has not landed. */
export function Soon({ icon, title, text, bullets }: { icon: IconName; title: ReactNode; text: ReactNode; bullets?: ReactNode[] }) {
  return (
    <Card className="flex flex-col items-center px-4 py-[30px] text-center">
      <span className="mx-auto mb-[11px] flex size-[46px] items-center justify-center rounded-[14px] bg-accent text-accent-foreground">
        <Icon name={icon} size="m" />
      </span>
      <h3 className="text-[16px]">{title}</h3>
      <p className="mt-1.5 max-w-[52ch] text-[12.5px] text-muted-foreground">{text}</p>
      {bullets && (
        <ul className="mx-auto my-4 flex list-none flex-col gap-[7px] p-0 text-left text-[12.5px] text-muted-foreground">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-center gap-2">
              <Icon name="ok" className="size-[14px] text-success" />
              {b}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
