import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes } from "react";

/**
 * Controls for the few places a field is built into a larger widget rather
 * than set out in a form: the message box in a chat, the search line of the
 * command palette, the rows of the mail composer, a number cell in a settings
 * list. They carry no look of their own (the caller styles them) and no
 * validation; anything that is a field in a form uses fields.tsx instead.
 * Every one needs a visible label or an aria-label.
 */
type InlineInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void };

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(function InlineInput({ value, onChange, ...rest }, ref) {
  return <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
});

export function InlineSelect({ value, onChange, options, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; options: Array<string | [string, string]> }) {
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

/** The label of an inline control, for a widget that lays its label out itself. */
export function InlineLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} />;
}
