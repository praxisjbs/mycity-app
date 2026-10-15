/**
 * @component Kbd
 * @group Display
 * @summary A keyboard key or shortcut, drawn as keycaps (⌘ K, Esc).
 * @use Beside a desktop action or in a menu to show its shortcut (search, the command palette, close).
 * @avoid A phone screen (there is no keyboard: it is hidden there); a key a person does not need to learn.
 * @phone Not shown.
 * @a11y Native kbd elements; a combination is read key by key. Pass label when a symbol needs words (⌘ is read as "Command").
 * @status stable
 * @example <Kbd keys={["⌘", "K"]} label="Command K" />
 * @example <Kbd>Esc</Kbd>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

const CAP = "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-sans text-2xs leading-none font-semibold text-muted-foreground";

export interface KbdProps {
  /** One key, as children (Esc, Enter). */
  children?: ReactNode;
  /** A combination, one keycap each, in order (["⌘", "K"]). */
  keys?: string[];
  /** What a screen reader says for the combination ("Command K"), when the keys are symbols. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Kbd({ children, keys, label, className }: KbdProps) {
  const caps = keys ?? [];
  return (
    <span data-kbd="" className={cn("inline-flex items-center gap-0.5 phone:hidden", className)} aria-label={label} role={label ? "img" : undefined}>
      {caps.length > 0 ? (
        <kbd className="inline-flex gap-0.5" aria-hidden={label ? true : undefined}>
          {caps.map((k, i) => (
            <kbd key={`${k}-${i}`} className={CAP}>
              {k}
            </kbd>
          ))}
        </kbd>
      ) : (
        <kbd className={CAP} aria-hidden={label ? true : undefined}>
          {children}
        </kbd>
      )}
    </span>
  );
}
