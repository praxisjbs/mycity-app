/**
 * @component ColorField
 * @group Forms
 * @summary A colour as #RRGGBB, pasted or typed, with a square of it beside the value.
 * @use A colour a person sets, such as a dark palette on Settings · Appearance, inside a Field, bound with form.field(name); the contract checks the value.
 * @avoid The browser's colour picker (gate 21); showing a colour a token already names (use Swatch).
 * @phone 44 px tall with 16 px text; the square stays beside the value; a plain keyboard, nothing corrected or capitalised for the person.
 * @a11y Takes its id, label and error links from the Field around it; the square is decorative, so the value is always read as text; aria-invalid follows the mark.
 * @status beta
 * @example <ColorField {...form.field("background")} />
 */
import type { CSSProperties, InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type" | "placeholder">;

export interface ColorFieldProps extends NativeInput {
  /** The colour as typed, from form.field(name): #RRGGBB or RRGGBB, any case. */
  value: string;
  /** Called with the new text, as typed or pasted. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
}

/** #RRGGBB for a value that is one, with or without its #; null while it is not. */
export function hexOf(value: string): string | null {
  const v = (value ?? "").trim();
  const hex = v.startsWith("#") ? v : `#${v}`;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

export function ColorField({ value, onChange, onBlur, state, message: _message, className, id, ...rest }: ColorFieldProps) {
  const a = useFieldControl({ id, state });
  const hex = hexOf(value);
  return (
    <span className="relative flex items-center">
      <i
        aria-hidden="true"
        data-swatch={hex ?? "none"}
        /* The one runtime value is the colour typed, as a variable the class reads. */
        style={hex ? ({ "--swatch": hex } as CSSProperties) : undefined}
        className={cn("pointer-events-none absolute left-2 block size-6 flex-none rounded-md border border-border", hex ? "bg-(--swatch)" : "bg-muted")}
      />
      <input
        {...rest}
        {...a}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={9}
        placeholder="#RRGGBB"
        className={cn(controlClass(a.state), "h-control pl-10 font-mono", a.state && "pr-9", className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {a.state === "bad" && <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />}
      {a.state === "good" && <Icon name="ok" size="s" className="pointer-events-none absolute right-3 text-success" />}
    </span>
  );
}
