/**
 * @component ThemePreview
 * @group Display
 * @summary A small copy of the hub drawn in a dark palette and two faces: the rail, a page title, two KPI cards, a list with a selected row, status pills, a field and the yellow button.
 * @use Settings · Appearance's live preview of a dark palette and its fonts before they are saved, beside the fields that set them.
 * @avoid Showing a real screen's records (it draws sample shapes, never data); the light theme (it previews the dark one only); a palette already applied (look at the page).
 * @phone Fills the width at the same proportions; the rail keeps to its icons; nothing scrolls sideways.
 * @a11y One image named by `label` ("Preview, Charcoal"); the sample inside is hidden from assistive technology, so its shapes and words are not read out.
 * @status beta
 * @example <ThemePreview label="Preview, Charcoal" tokens={derived.tokens} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";

export interface ThemePreviewProps {
  /** What the picture is, for assistive technology: "Preview, Charcoal". */
  label: string;
  /** The dark tokens to draw with (the contract's deriveDark), by name without the dashes; none draws the dark theme in force. */
  tokens?: Record<string, string> | null;
  /** The two faces as CSS font-family lists (fontStack); none keeps the page's. */
  faces?: { heading: string; body: string };
  /** Layout classes only (spacing, width). */
  className?: string;
}

const NAME = /^[a-z][a-z0-9-]*$/;

/** The palette and faces as the variables the classes inside read. */
function variablesOf(tokens: ThemePreviewProps["tokens"], faces: ThemePreviewProps["faces"]): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens ?? {})) if (NAME.test(name)) vars[`--${name}`] = value;
  if (faces) {
    vars["--face-body"] = faces.body;
    vars["--face-heading"] = faces.heading;
  }
  return vars as CSSProperties;
}

/** A line of text drawn as a bar in an ink, so the preview carries shapes, not records. */
const Line = ({ ink, w }: { ink: string; w: string }) => <i className={cn("block h-1.5 rounded-full", ink, w)} />;

export function ThemePreview({ label, tokens, faces, className }: ThemePreviewProps) {
  return (
    <div
      role="img"
      aria-label={label}
      data-theme="dark"
      /* The palette is the one runtime value: variables the token classes read, inside this box only. */
      style={variablesOf(tokens, faces)}
      className={cn("flex overflow-hidden rounded-card border border-border bg-background font-sans text-foreground", className)}
    >
      <div aria-hidden="true" {...content} className="flex w-full">
        <div className="flex w-11 flex-none flex-col items-center gap-2 bg-sidebar py-3">
          <Icon name="pin" className="text-sidebar-primary" />
          <span className="mt-1 grid size-7 place-items-center rounded-box bg-sidebar-accent text-sidebar-accent-foreground">
            <Icon name="home" size="s" />
          </span>
          {(["grid", "users", "msg", "cog"] as const).map((g) => (
            <span key={g} className="grid size-7 place-items-center text-sidebar-muted">
              <Icon name={g} size="s" />
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-2xs font-strong tracking-caps text-eyebrow uppercase">Today</span>
              <span className="block truncate font-heading text-lg font-strong">Home</span>
            </div>
            <span className="flex-none rounded-full bg-primary px-3 py-1 text-2xs font-strong text-primary-foreground">Clock In</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Present", "37", "text-success"],
              ["Late", "4", "text-warning"],
            ].map(([title, figure, ink]) => (
              <div key={title} className="rounded-box border border-border bg-card p-2">
                <span className="block text-2xs font-semibold text-muted-foreground">{title}</span>
                <span className="block font-heading text-xl font-bold">{figure}</span>
                <Line ink={cn("bg-current opacity-80", ink)} w="w-8" />
              </div>
            ))}
          </div>
          <div className="rounded-box border border-border bg-card">
            {[false, true, false].map((on, i) => (
              <div key={i} className={cn("flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0", on && "bg-accent")}>
                <i className="block size-4 flex-none rounded-full bg-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <Line ink={on ? "bg-accent-foreground" : "bg-foreground"} w="w-20" />
                  <Line ink="bg-subtle-foreground" w="w-12" />
                </span>
                <span
                  className={cn(
                    "flex-none rounded-full px-1.5 py-0.5 text-2xs font-strong",
                    ["bg-success-soft text-success", "bg-warning-soft text-warning", "bg-destructive-soft text-destructive"][i],
                  )}
                >
                  {["On Time", "Late", "Absent"][i]}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 flex-1 items-center rounded-ctl border border-input bg-popover px-2 text-2xs text-subtle-foreground">Search people</span>
            <span className="flex-none text-2xs font-strong text-accent-foreground">View All</span>
          </div>
        </div>
      </div>
    </div>
  );
}
