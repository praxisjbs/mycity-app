/**
 * @component FormatButton
 * @group Data
 * @summary A button that makes one file in a format: the format straight away when there is one, a choice of formats when there are two or more.
 * @use A screen's own export of what it shows, in a format the person picks (the Overview's and Workspace Analytics' Export, Run Now on a report).
 * @avoid A list's export of its filtered rows in one format (ExportButton); several unrelated actions behind one button (Menu).
 * @phone The choice opens as an action sheet from the bottom, large rows; one format is a plain button.
 * @a11y A Button, busy from the press until the file is saved and pressable rather than disabled; the choice is a Radix menu (arrow keys, Enter, Esc returns focus) named by `label`.
 * @status stable
 * @example <FormatButton label="Export" formats={["pdf", "xlsx"]} onRun={exportAs} item={(f) => `Export ${f.toUpperCase()}`} />
 */
import { useState } from "react";
import { Button } from "../actions/Button";
import { Menu } from "../overlay/Menu";

export interface FormatButtonProps<F extends string = string> {
  /** The button's words: Verb Noun, at most 3 words ("Export", "Run Now"). */
  label: string;
  /** The formats it can make, in the order offered; one makes the button press straight to it. */
  formats: readonly F[];
  /** Makes the file in the chosen format and saves it; the button is busy until it settles. */
  onRun: (format: F) => Promise<unknown>;
  /** A choice's words, from its format ("Export PDF", "Run as XLSX"). */
  item: (format: F) => string;
  /** Busy for work the press did not hand back (a request already waiting). */
  busy?: boolean;
  /** Small on a card (the default); the page header's own size beside its other actions. */
  size?: "sm" | "md";
  /** Layout classes only (spacing). */
  className?: string;
}

/**
 * One press, one file (F26): the format's work is handed back, so the button stays busy until
 * the file is saved, a choice made from the menu included, and a second press is refused.
 */
export function FormatButton<F extends string>({ label, formats, onRun, item, busy = false, size = "sm", className }: FormatButtonProps<F>) {
  const [running, setRunning] = useState(false);
  const run = async (format: F) => {
    if (running) return;
    setRunning(true);
    try {
      await onRun(format);
    } finally {
      setRunning(false);
    }
  };
  const [only] = formats;
  if (formats.length === 1 && only !== undefined)
    return (
      <Button size={size} busy={busy || running} className={className} onClick={() => run(only)}>
        {label}
      </Button>
    );
  return (
    <Menu
      label="Choose Format"
      trigger={(p) => (
        <Button {...p} size={size} busy={busy || running} className={className}>
          {label}
        </Button>
      )}
      items={formats.map((format) => ({ label: item(format), icon: "doc", onSelect: () => void run(format) }))}
    />
  );
}
