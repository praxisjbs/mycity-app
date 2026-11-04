/**
 * @component RatingField
 * @group Forms
 * @summary A rating from 1 to 10 (or another top from 3 to 10) as a row of stars, a tap on the seventh star rating it 7; disabled locks a given rating in place, readOnly draws one already given or a panel's mean.
 * @use A score a person gives by eye against a scale: a trait on the interview card, an overall rating. disabled for a card already submitted; readOnly for ratings and averages shown back once a panel's round closes.
 * @avoid A number that is counted or typed (use NumberField); a choice between named options (use ChoiceField or RadioCards); a rating that saves the moment it is tapped outside a form (pair it with the form's own save).
 * @phone Every star is a 44 px target; ten stars sit in two rows of five so the row never runs off a 390 px screen. No hover preview: the tap is the choice. On desktop the stars follow the density (36 px Compact, 40 px Comfortable).
 * @a11y A radio group: each star is a radio named "7 of 10"; Left and Right, Up and Down, Home and End move and choose, and the readout beside it is hidden so the value is never read twice. Inside a Field its label names the group (and the readOnly image) and the error is linked; alone, pass label. readOnly is one image named "Level of Confidence: 7 of 10".
 * @status beta
 * @example <Field label="Level of Confidence" {...form.status("confidence")}><RatingField {...form.field("confidence")} /></Field>
 * @example <RatingField label="Oral Communication Skills" value={7.3} readOnly decimals={1} />
 */
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";

export interface RatingFieldProps {
  /** The rating given, 1 to max; null while none is given. A value off the scale shows as not rated. readOnly also takes a mean (7.4), its stars rounded. */
  value: number | null;
  /** Called with the rating tapped or chosen with the keys. Not needed when readOnly or disabled. */
  onChange?: (value: number) => void;
  /** Called when focus leaves the stars. */
  onBlur?: () => void;
  /** The top of the scale, 3 to 10; 10 unless set. */
  max?: number;
  /** Names the stars when no Field label sits above them. */
  label?: string;
  /** Shows the rating in place but takes no change: a card already submitted. */
  disabled?: boolean;
  /** Draws the rating as a picture without letting it change: a panelist's rating, or a trait's mean, once the round is closed. */
  readOnly?: boolean;
  /** readOnly only: decimal places in the readout, so a column of means reads alike (1 shows 7 as 7.0). A whole number and one decimal otherwise. */
  decimals?: number;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Layout classes only. */
  className?: string;
}

const scaleTop = (max: number) => (Number.isFinite(max) ? Math.min(10, Math.max(3, Math.round(max))) : 10);

function Star({ on, className }: { on: boolean; className?: string }) {
  return (
    <Icon
      name="star"
      className={cn(
        "transition-colors duration-(--dur-fast)",
        on ? "fill-primary text-foreground" : "fill-none text-subtle-foreground",
        className,
      )}
    />
  );
}

export function RatingField({
  value,
  onChange,
  onBlur,
  max = 10,
  label,
  disabled,
  readOnly,
  decimals,
  state,
  message: _message,
  className,
}: RatingFieldProps) {
  const top = scaleTop(max);
  const stars = Array.from({ length: top }, (_, i) => i + 1);
  const a = useFieldControl({ state, group: true });
  const valueId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (readOnly) {
    const v = value != null && Number.isFinite(value) && value >= 0 ? Math.min(top, value) : null;
    const shown = v == null ? 0 : Math.round(v);
    const text = v == null ? "" : decimals != null ? v.toFixed(decimals) : Number.isInteger(v) ? String(v) : v.toFixed(1);
    const name = v == null ? `Not rated, out of ${top}` : `${text} of ${top}`;
    const byField = !label && a["aria-labelledby"];
    return (
      <span
        role="img"
        aria-label={byField ? undefined : label ? `${label}: ${name}` : name}
        aria-labelledby={byField ? `${a["aria-labelledby"]} ${valueId}` : undefined}
        className={cn("inline-flex items-center gap-2", className)}
      >
        <span className="inline-flex items-center gap-0.5">
          {stars.map((n) => (
            <Star key={n} on={n <= shown} className="size-4" />
          ))}
        </span>
        {v != null && <span className="text-sm font-strong tabular-nums text-foreground">{text}</span>}
        {byField && (
          <span id={valueId} className="sr-only">
            {name}
          </span>
        )}
      </span>
    );
  }

  /* Only a whole number on the scale is a rating; anything else shows as not rated yet. */
  const rated = value != null && Number.isInteger(value) && value >= 1 && value <= top ? value : null;
  const choose = (n: number) => {
    if (disabled) return;
    setHover(null);
    onChange?.(Math.min(top, Math.max(1, n)));
  };
  /* Moving between stars is not leaving the field: onBlur fires only when focus goes elsewhere. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (!onBlur) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    onBlur();
  };
  /* Left and Right are the radio group's own; Home, End, Up and Down choose too (Up is one more star). */
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    setHover(null);
    if (disabled) return;
    const at = rated ?? 0;
    const next = e.key === "Home" ? 1 : e.key === "End" ? top : e.key === "ArrowUp" ? at + 1 : e.key === "ArrowDown" ? at - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = Math.min(top, Math.max(1, next));
    choose(n);
    e.currentTarget.querySelector<HTMLElement>(`[data-star="${n}"]`)?.focus();
  };
  /* The preview fills the stars under the mouse; the chosen rating stays in the readout beside them. */
  const lit = hover ?? rated ?? 0;
  return (
    <div className={cn("inline-flex items-center gap-3", disabled && "opacity-60", className)}>
      <RadioGroup.Root
        /* "" matches no star, so nothing is checked while the field stays controlled. */
        value={rated == null ? "" : String(rated)}
        onValueChange={(v) => choose(Number(v))}
        onBlur={leave}
        onKeyDown={keys}
        onPointerLeave={() => setHover(null)}
        disabled={disabled}
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
            data-star={n}
            aria-label={`${n} of ${top}`}
            data-ui="button"
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse" && !disabled) setHover(n);
            }}
            onClick={() => setHover(null)}
            className="flex size-tap items-center justify-center rounded-ctl focus-visible:-outline-offset-2 disabled:cursor-default"
          >
            <Star on={n <= lit} className="size-5 phone:size-6" />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <span aria-hidden="true" className="min-w-8 text-sm font-strong tabular-nums text-foreground">
        {rated != null ? `${rated}/${top}` : ""}
      </span>
    </div>
  );
}
