/**
 * @component KpiCard
 * @group Display
 * @summary One figure a person acts on: its title, the number, and a short trend line; with `onOpen` it becomes the way into the records behind it.
 * @use A role's figures at the top of Home, a record's own counts, a module's four tiles above its list.
 * @avoid A sentence about the number (put it behind the help); a tile for a figure nobody acts on; more than four on one row.
 * @phone Two to a row in a KpiGrid, with the number a size smaller; opening one shows its records as a bottom sheet.
 * @a11y A tile that opens something is a button named by its title and value, with the chevron decorative; its help is an InfoButton beside the button, never a focusable term inside it; the trend's direction is a word, never colour alone.
 * @status stable
 * @example <KpiCard title="Clocked In Today" value="22 of 25" onOpen={() => openDetail("attendance.punched")} />
 * @example <KpiCard title="Owed This Month" value={<Money value={total} short />} tone="warn" caption="4 overdue" trend="up" />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { slot } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { Card } from "../layout/Card";
import { HelpTerm } from "../help/HelpTerm";
import { InfoButton } from "../help/InfoButton";
import type { StatusTone } from "./Pill";

/** Which way the figure has moved since the last period. */
export type KpiTrend = "up" | "down" | "flat";

const INK: Record<StatusTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  err: "text-destructive",
  info: "text-info",
  neutral: "",
};

const TREND: Record<KpiTrend, { ink: string; icon: "up" | "down" | "sort"; word: string }> = {
  up: { ink: "text-success", icon: "up", word: "up" },
  down: { ink: "text-destructive", icon: "down", word: "down" },
  flat: { ink: "text-subtle-foreground", icon: "sort", word: "level" },
};

export interface KpiCardProps {
  /** The figure's name, Title Case, at most 4 words (Clocked In Today). */
  title: ReactNode;
  /** The figure itself: a count, a Money, a fraction ("22 of 25"). */
  value: ReactNode;
  /** The number's tone, when the figure itself is good or bad news. */
  tone?: StatusTone;
  /** The line under the number, at most 5 words (4 overdue, 3 more than last month). */
  caption?: ReactNode;
  /** Which way it has moved; the caption then carries an arrow and the direction as a word. */
  trend?: KpiTrend;

  /**
   * Support text, at most 35 words: what the figure counts. On a plain tile it
   * sits behind the title as a help term; on a tile that opens its records it
   * is an ⓘ beside the number instead, because a focusable term cannot live
   * inside the button that opens them.
   */
  help?: ReactNode;
  /** The figure's name as plain words, when `title` is not a string: the ⓘ's name and the help sheet's title. */
  helpLabel?: string;
  /** Opens the records behind the number (the report model). Without it the tile is plain. */
  onOpen?: () => void;
  /**
   * Where the tile is clickable. `all` (the default) on both; `phone` when the
   * desktop page already shows the detail beside the tiles, so desktop gets no
   * second way to the same thing.
   */
  opensOn?: "all" | "phone";
  /** Layout classes only (spacing). */
  className?: string;
}

export function KpiCard({ title, value, tone, caption, trend, help, helpLabel, onOpen, opensOn = "all", className }: KpiCardProps) {
  const phone = useIsPhone();
  const open = opensOn === "phone" && !phone ? undefined : onOpen;
  const moved = trend ? TREND[trend] : null;

  const figure = (named: ReactNode) => (
    <>
      <span {...slot("title")} className="text-2xs font-semibold text-muted-foreground">
        {named}
      </span>
      <b className={cn("mt-0.5 block text-3xl leading-tight font-bold phone:text-2xl", tone && INK[tone])}>{value}</b>
      {caption != null && (
        <span {...slot("kpi-caption")} className={cn("mt-1.5 inline-flex items-center gap-1 text-2xs font-strong", moved ? moved.ink : "text-subtle-foreground")}>
          {moved && <Icon name={moved.icon} size="s" label={moved.word} />}
          {caption}
        </span>
      )}
    </>
  );

  if (!open) return <Card className={className}>{figure(help ? <HelpTerm help={help}>{title}</HelpTerm> : title)}</Card>;

  /*
   * The whole tile opens its records, so the tile is a stretched button rather
   * than a card wrapping one. Its help, where it has any, sits outside that
   * button and above its overlay: a control inside a control is a serious axe
   * violation, and on a phone it would also be an unhittable 44 px target.
   */
  const name = helpLabel ?? (typeof title === "string" ? title : "This Figure");
  return (
    <div
      className={cn(
        "relative max-w-full min-w-0 rounded-card border border-border bg-card p-3.5 shadow-1 transition hover:border-subtle-foreground hover:shadow-2",
        className,
      )}
    >
      <button type="button" onClick={open} className="stretch-link block w-full text-left">
        {figure(title)}
      </button>
      <span aria-hidden="true" className="absolute top-3 right-3 text-subtle-foreground opacity-45">
        <Icon name="right" size="s" />
      </span>
      {help && <InfoButton label={name} help={help} className="absolute right-2 bottom-2 z-10" />}
    </div>
  );
}
