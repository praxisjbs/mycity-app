/**
 * @component MoreFields
 * @group Forms
 * @summary The fields a form rarely needs, closed under one More row until the person opens it.
 * @use Optional fields most people leave alone, where the feature guide names them for More (a key result's co-owner, baseline and start). Pass `invalid` so a marked field inside is never hidden.
 * @avoid A required field (it stays open); support text (use HelpTerm or Details); a second topic (use Wizard); more than one More in a form.
 * @phone A 44 px row that opens the fields in place, inside the form's sheet, never a sheet of its own.
 * @a11y A button with aria-expanded that controls the fields. Closed fields stay mounted and keep their values; it opens itself while one is marked, so check() can reach it.
 * @status beta
 * @example <MoreFields invalid={Boolean(f.status("baseline_text").message)}><Field label="Baseline" optional><TextField {...f.field("baseline_text")} /></Field></MoreFields>
 */
import { useId, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface MoreFieldsProps {
  /** The fields behind the row (Field and its control, from the form system). */
  children?: ReactNode;
  /** The row's word, Title Case, at most 3 words. Default "More". */
  label?: string;
  /** A field inside is marked: it opens and stays open while one is. */
  invalid?: boolean;
  /** Opens on arrival (an edit whose fields here hold values). Closed otherwise. */
  defaultOpen?: boolean;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

export function MoreFields({ children, label = "More", invalid = false, defaultOpen = false, className }: MoreFieldsProps) {
  const bodyId = `more-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [opened, setOpened] = useState(defaultOpen);
  const open = opened || invalid;
  return (
    <div data-ui="more-fields" className={cn("mb-3", className)}>
      <button
        type="button"
        data-ui="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpened(!open)}
        className="flex min-h-control w-full items-center gap-1.5 rounded-ctl px-1 text-left text-sm font-semibold text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground phone:min-h-tap"
      >
        <Icon name="right" className={cn("transition-transform duration-(--dur-fast)", open && "rotate-90")} />
        {label}
      </button>
      {/* Closed fields stay mounted, so what was typed there is kept and still checked. */}
      <div id={bodyId} hidden={!open} className="pt-2">
        {children}
      </div>
    </div>
  );
}
