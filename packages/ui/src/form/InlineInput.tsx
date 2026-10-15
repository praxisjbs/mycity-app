/**
 * @component InlineInput
 * @group Forms
 * @summary Unstyled controls for a field built into a larger widget: the chat message box, the command palette's search line, the mail composer's rows.
 * @use Only inside another shared component or widget that styles them itself; never as a form field.
 * @avoid A field in a form (use Field with TextField and the rest); a control with no label.
 * @phone The caller's widget decides its size; keep 16 px text so iOS never zooms.
 * @a11y Every one needs a visible label or an aria-label; InlineLabel gives a widget a label it lays out itself.
 * @status stable
 * @exports InlineSelect, InlineLabel
 * @example <InlineInput aria-label="Message" value={text} onChange={setText} />
 */
import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes } from "react";

export interface InlineInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  /** The text. */
  value: string;
  /** Called on each key with the new text. */
  onChange: (value: string) => void;
}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(function InlineInput({ value, onChange, ...rest }, ref) {
  return <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
});

export interface InlineSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  /** The chosen value. */
  value: string;
  /** Called with the chosen value. */
  onChange: (value: string) => void;
  /** Options as plain strings or [value, label] pairs. */
  options: Array<string | [string, string]>;
}

export function InlineSelect({ value, onChange, options, ...rest }: InlineSelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map((o) => {
        const [v, l] = typeof o === "string" ? [o, o] : o;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export type InlineLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

/** The label of an inline control, for a widget that lays its label out itself. */
export function InlineLabel(props: InlineLabelProps) {
  return <label {...props} />;
}
