import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { HelpTerm } from "./Help";

/** The raised panel every section sits in. */
export function Card({ className, pad = true, ...rest }: HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return (
    <div
      className={cn("max-w-full min-w-0 rounded-card border border-border bg-card shadow-1", pad ? "p-[14px]" : "overflow-hidden", className)}
      {...rest}
    />
  );
}

/**
 * A card's title row, with anything on the right. `help` makes the title a help
 * term (§5.2). `record` says the title is a record's own name (EXP-0122 · Stage
 * hire), which is content, not interface copy (§5.3).
 */
export function CardHeader({ title, help, record, right, className, children }: { title?: ReactNode; help?: ReactNode; record?: boolean; right?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("mb-3 flex items-center gap-2", className)}>
      {title != null && <h3 {...(record ? { "data-copy": "content" } : { "data-ui": "title" })} className="text-[13.5px] font-[650]">{help ? <HelpTerm text={help}>{title}</HelpTerm> : title}</h3>}
      {children}
      {right != null && <span className="ml-auto flex items-center gap-1.5">{right}</span>}
    </div>
  );
}

/** Page title, its one-line subtitle (desktop only) and the page's actions. `help` makes the title a help term (§5.2). */
export function PageHead({ title, help, sub, actions, children }: { title: ReactNode; help?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 data-ui="page-title" className="flex items-center gap-1.5 text-[20px]">{help ? <HelpTerm text={help}>{title}</HelpTerm> : title}</h1>
        {sub && <p data-ui="page-subtitle" className="mt-[3px] text-[13px] text-muted-foreground max-md:hidden">{sub}</p>}
      </div>
      {children}
      {actions && <div className="flex flex-wrap gap-2 md:ml-auto">{actions}</div>}
    </div>
  );
}

const COLS = {
  4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
  "4m2": "grid-cols-2 xl:grid-cols-4",
  3: "grid-cols-1 xl:grid-cols-3",
  2: "grid-cols-1 lg:grid-cols-2",
  "1.4/1": "grid-cols-1 xl:grid-cols-[1.4fr_1fr]",
  "1/1.5": "grid-cols-1 xl:grid-cols-[1fr_1.5fr]",
} as const;

/**
 * The prototype's grids: 4, 3, 2 columns and the two uneven splits, collapsing
 * at its own widths. "4m2" keeps two columns on a phone (KPI tiles).
 */
export function Grid({ cols, className, ...rest }: HTMLAttributes<HTMLDivElement> & { cols: keyof typeof COLS }) {
  return <div className={cn("mb-3 grid gap-3", cols === "4m2" && "max-md:gap-2.5", COLS[cols], className)} {...rest} />;
}

/** Secondary text: 11.5 px, the faintest ink. */
export function Sub({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-[11.5px] text-subtle-foreground", className)} {...rest} />;
}

/** Shown on a phone only, or on a desktop only (gate 11: decided per screen). */
export const MobileOnly = ({ children }: { children: ReactNode }) => <div className="md:hidden">{children}</div>;
export const DesktopOnly = ({ children }: { children: ReactNode }) => <div className="max-md:hidden">{children}</div>;
