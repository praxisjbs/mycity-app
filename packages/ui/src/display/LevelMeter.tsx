/**
 * @component LevelMeter
 * @group Display
 * @summary A level drawn as a few short bars, filled up to the level: how much access a role has to a module.
 * @use A role's access to a module (No Access, View, Add, Edit, Full) in a permissions row or matrix; any short ordered scale of a few steps.
 * @avoid A measure against a whole, such as leave used (use Meter); a status (use Pill); a scale of more than about six steps (use Meter with its figure).
 * @phone The same size; it is never a tap target on its own, so a row that opens on a tap keeps its own 44 px.
 * @a11y An image named by its label and count ("Edit, 3 of 4"), so the level is read, not guessed from the fill. With decorative it is hidden, for when the level's name is shown beside it.
 * @status stable
 * @example <LevelMeter value={3} label="Edit" />
 * @example <LevelMeter value={level.rank} label={level.name} decorative />
 */
import { cn } from "../lib/cn";

/** The number of steps when max is not set: No Access, View, Add, Edit, Full. */
const STEPS = 4;

export interface LevelMeterProps {
  /** How many steps are filled, from 0 to max. */
  value: number;
  /** How many steps there are. Default 4. */
  max?: number;
  /** The level's name ("Edit"): the meter is read as "Edit, 3 of 4". */
  label: string;
  /** The name is shown beside the meter, so assistive technology skips the meter. */
  decorative?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function LevelMeter({ value, max = STEPS, label, decorative = false, className }: LevelMeterProps) {
  const steps = Number.isFinite(max) ? Math.max(0, Math.round(max)) : STEPS;
  const filled = Number.isFinite(value) ? Math.min(steps, Math.max(0, Math.round(value))) : 0;
  const a11y = decorative ? ({ "aria-hidden": true } as const) : ({ role: "img", "aria-label": `${label}, ${filled} of ${steps}` } as const);
  return (
    <span {...a11y} data-level={filled} className={cn("inline-flex flex-none items-center gap-0.5 align-middle", className)}>
      {Array.from({ length: steps }, (_, step) => {
        const on = step < filled;
        return (
          <span
            key={step}
            data-state={on ? "filled" : "empty"}
            /* City Green fills on light; in dark it sits below the empty bars' tone, so the fill turns brand yellow, as the logo and tabs do. */
            className={cn("block h-3.5 w-1 rounded-sm", on ? "bg-secondary dark:bg-primary" : "bg-border")}
          />
        );
      })}
    </span>
  );
}
