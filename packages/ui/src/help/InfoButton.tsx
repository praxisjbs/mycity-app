/**
 * @component InfoButton
 * @group Help
 * @summary The ⓘ, for help that has no word to attach to: a chart, an icon-only control, a figure with no title.
 * @use Rarely: only where HelpTerm has no word to sit on. Same text rules as HelpTerm (one or two sentences, at most 35 words).
 * @avoid Beside a word (make the word a HelpTerm, so the screen is not covered in ⓘ marks); a section of facts (use Details); tier 3 explanations of how the system works.
 * @phone A 44 px target; a tap opens the text in a bottom sheet titled by `label`.
 * @a11y A button named "About <label>" whose aria-describedby points at the text, kept visually hidden in the DOM outside any label or heading. Desktop: opens after about 300 ms on hover or on reaching it with Tab, stays while the pointer is over it or the popover, Esc closes it (WCAG 1.4.13).
 * @status stable
 * @example <InfoButton label="Overtime Trend" help="Hours past the rostered shift, by week, for the last 12 weeks." />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { HelpSurface } from "./HelpTerm";
import { WORD_LIMITS, warnOverLimit } from "./words";

export interface InfoButtonProps {
  /** What it explains, in Title Case ("Overtime Trend"): the sheet's title, and the button's name as "About Overtime Trend". */
  label: string;
  /** The help: one or two sentences, at most 35 words, sentence case. */
  help: ReactNode;
  /** The hidden text's id, when another element should be described by it too. */
  helpId?: string;
  /** Which side the desktop popover opens on. Default `top`. */
  side?: "top" | "right" | "bottom" | "left";
  /** The popover's alignment along that side. Default `center`. */
  align?: "start" | "center" | "end";
  /** Where the popover and the sheet mount; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Layout classes only. */
  className?: string;
}

const ABOUT = /^about\s+/i;

export function InfoButton({ label, help, helpId, side, align, container, className }: InfoButtonProps) {
  warnOverLimit("Help text", help, WORD_LIMITS.help);
  const thing = label.replace(ABOUT, "");
  const title = thing.charAt(0).toUpperCase() + thing.slice(1);
  return (
    <HelpSurface
      help={help}
      title={title}
      helpId={helpId}
      side={side}
      align={align}
      container={container}
      trigger={
        <button
          type="button"
          aria-label={`About ${title}`}
          data-info-button=""
          className={cn(
            "inline-flex size-6 flex-none items-center justify-center rounded-full align-middle text-subtle-foreground transition-colors duration-(--dur-fast) hover:bg-accent hover:text-accent-foreground phone:-my-2.5 phone:size-tap",
            className,
          )}
        >
          <Icon name="info" />
        </button>
      }
    />
  );
}
