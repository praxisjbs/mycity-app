/**
 * @component RatingField
 * @group Forms
 * @summary A rating from 1 to 10 (or another top from 3 to 10) as a row of stars, a tap on the seventh star rating it 7; readOnly draws a rating already given.
 * @use A score a person gives by eye against a scale: a trait on the interview card, an overall rating. readOnly for ratings shown back once a panel's round closes.
 * @avoid A number that is counted or typed (use NumberField); a choice between named options (use ChoiceField or RadioCards); a rating that saves the moment it is tapped outside a form (pair it with the form's own save).
 * @phone Every star is a 44 px target; ten stars sit in two rows of five so the row never runs off a 390 px screen. No hover preview: the tap is the choice.
 * @a11y A radio group: each star is a radio named "7 of 10", the arrow keys move and choose, and the readout beside it is hidden so the value is never read twice. Inside a Field its label names the group and the error is linked; alone, pass label. readOnly is one image named "7 of 10".
 * @status beta
 * @example <Field label="Level of Confidence" {...form.status("confidence")}><RatingField {...form.field("confidence")} /></Field>
 * @example <RatingField label="Oral Communication Skills" value={7} readOnly />
 */
import { useState, type FocusEvent } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";

export interface RatingFieldProps {
  /** The rating given, 1 to max; null while none is given. readOnly also takes a mean (7.4), shown to one decimal with the stars rounded. */
  value: number | null;
  /** Called with the rating tapped or chosen with the keys. Not needed when readOnly. */
  onChange?: (value: number) => void;
  /** Called when focus leaves the stars. */
  onBlur?: () => void;
  /** The top of the scale, 3 to 10; 10 unless set. */
  max?: number;
  /** Names the stars when no Field label sits above them. */
  label?: string;
  /** Draws the rating without letting it change: a panelist's rating once the round is closed. */
  readOnly?: boolean;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Layout classes only. */
  className?: string;
}

const clampMax = (max: number) => Math.min(10, Math.max(3, Math.round(max)));
const readout = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function Star({ on, preview, className }: { on: boolean; preview: boolean; className?: string }) {
  return (
    <Icon
      name="star"
      className={cn(
        "transition-colors duration-(--dur-fast)",
        on ? "fill-primary text-foreground" : preview ? "fill-primary-tint text-foreground" : "fill-none text-subtle-foreground",
        className,
      )}
    />
  );
}

export function RatingField({ value, onChange, onBlur, max = 10, label, readOnly, state, message: _message, className }: RatingFieldProps) {
  const top = clampMax(max);
  const stars = Array.from({ length: top }, (_, i) => i + 1);
  const a = useFieldControl({ state, group: true });
  const [hover, setHover] = useState<number | null>(null);

  if (readOnly) {
    const shown = value == null ? 0 : Math.round(value);
    const name = value == null ? `Not rated, out of ${top}` : `${readout(value)} of ${top}`;
    return (
      <span role="img" aria-label={label ? `${label}: ${name}` : name} className={cn("inline-flex items-center gap-2", className)}>
        <span className="inline-flex items-center gap-0.5">
          {stars.map((n) => (
            <Star key={n} on={n <= shown} preview={false} className="size-4" />
          ))}
        </span>
        {value != null && <span className="text-sm font-strong tabular-nums text-foreground">{readout(value)}</span>}
      </span>
    );
  }

  /* Moving between stars is not leaving the field: onBlur fires only when focus goes elsewhere. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (!onBlur) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    onBlur();
  };
  const lit = hover ?? value ?? 0;
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <RadioGroup.Root
        /* "" matches no star, so nothing is checked while the field stays controlled. */
        value={value == null ? "" : String(value)}
        onValueChange={(v) => onChange?.(Number(v))}
        onBlur={leave}
        onPointerLeave={() => setHover(null)}
        orientation="horizontal"
        loop={false}
        aria-label={label}
        aria-labelledby={label ? undefined : a["aria-labelledby"]}
        aria-describedby={a["aria-describedby"]}
        aria-invalid={a["aria-invalid"]}
        className={cn(
          "flex items-center gap-0.5 rounded-box border border-transparent phone:grid phone:grid-cols-5 phone:gap-0",
          a.state === "bad" && "border-destructive",
        )}
      >
        {stars.map((n) => (
          <RadioGroup.Item
            key={n}
            value={String(n)}
            aria-label={`${n} of ${top}`}
            data-ui="button"
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setHover(n);
            }}
            className="flex size-8 items-center justify-center rounded-ctl focus-visible:-outline-offset-2 phone:size-tap phone:min-h-11 phone:min-w-11"
          >
            <Star on={hover == null && n <= lit} preview={hover != null && n <= lit} className="size-5 phone:size-6" />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <span aria-hidden="true" className="min-w-8 text-sm font-strong tabular-nums text-foreground">
        {value != null ? `${value}/${top}` : ""}
      </span>
    </div>
  );
}
