/**
 * @component LinesField
 * @group Forms
 * @summary A request's lines: each an Item, a Quantity and a Unit Price (a minus taken for a discount or a payment already made), its Amount worked out, Add Line under them and the Total beside it, counted in kobo, never in floating point.
 * @use New Request's lines (Expenses), and Edit on a Praxis AI card whose field is `lines` (an invoice read into a request); bind it with useContractForm's field("lines") and send the lines through toMoneyString.
 * @avoid One amount (MoneyField); a list of names or ids (a picker); a table a person only reads (DataView, or the card's own lines table).
 * @phone Each line is two columns: the item full width, then Quantity and Unit Price side by side, the Amount and the remove button under them; Add Line and the Total stay at the foot; every target is 44 px.
 * @a11y A group named by its Field's label; each control is labelled (Item 1, Quantity, Unit Price); the remove button names its line (Remove Item 2); the Total is text, its minus read, never colour alone.
 * @status beta
 * @example <LinesField value={lines} onChange={setLines} />
 */
import { cn } from "../lib/cn";
import { Button, IconButton } from "../actions/Button";
import { Money } from "../display/Money";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { MoneyField, toMoneyString } from "./MoneyField";

/** One line as the form holds it: what a person typed, the unit price perhaps with commas or a minus. */
export interface LineValue {
  description: string;
  quantity: string;
  unit_price: string;
}

export interface LinesFieldProps {
  /** The lines as typed. */
  value: LineValue[];
  /** Called with every line after a change. */
  onChange: (lines: LineValue[]) => void;
  /** The most lines a request holds (the contract's 25). */
  max?: number;
  /** The field's name, so a failed submit can focus its first control. */
  name?: string;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** An empty line: one of an item, its price still to type. */
export const EMPTY_LINE: LineValue = Object.freeze({ description: "", quantity: "1", unit_price: "" }) as LineValue;

/** An amount typed or on the wire, in kobo, signed; 0 for one that is not an amount yet. */
function koboOf(typed: string): bigint {
  const wire = toMoneyString(String(typed || ""));
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(wire);
  if (!m) return 0n;
  const k = BigInt(m[2] ?? "0") * 100n + BigInt(m[3] ?? "0");
  return m[1] ? -k : k;
}

/** A quantity in hundredths ("1.5" is 150); 0 for one that is not a number yet. */
function hundredthsOf(quantity: string): bigint {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(quantity || "").trim());
  return m ? BigInt(m[1] ?? "0") * 100n + BigInt(((m[2] ?? "") + "00").slice(0, 2)) : 0n;
}

/** Kobo as the wire's two-place string ("-100000.00"). */
function wireOf(kobo: bigint): string {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** One line's amount, quantity times unit price rounded to the kobo half away from zero, as the server rounds it. */
export function lineAmount(line: Pick<LineValue, "quantity" | "unit_price">): string {
  const n = koboOf(line.unit_price) * hundredthsOf(line.quantity || "1");
  const abs = n < 0n ? -n : n;
  const rounded = (abs + 50n) / 100n;
  return wireOf(n < 0n ? -rounded : rounded);
}

/** The lines' total, the sum of their amounts, as the wire's two-place string. */
export function linesTotal(lines: Array<Pick<LineValue, "quantity" | "unit_price">>): string {
  return wireOf(lines.reduce((sum, l) => sum + koboOf(lineAmount(l)), 0n));
}

export function LinesField({ value, onChange, max = 25, name = "lines", className }: LinesFieldProps) {
  const lines = value.length ? value : [{ ...EMPTY_LINE }];
  const set = (i: number, change: Partial<LineValue>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-6 items-end gap-2 max-md:grid-cols-2">
          <span className="col-span-2 max-md:col-span-2">
            <Field label={`Item ${i + 1}`}>
              <TextField name={i === 0 ? name : `${name}-${i}-description`} value={l.description} onChange={(v) => set(i, { description: v })} placeholder="Crates of water" />
            </Field>
          </span>
          <Field label="Quantity">
            <TextField name={`${name}-${i}-quantity`} inputMode="decimal" value={l.quantity} onChange={(v) => set(i, { quantity: v.replace(/[^\d.]/g, "") })} />
          </Field>
          <Field label="Unit Price">
            <MoneyField signed name={`${name}-${i}-unit_price`} value={l.unit_price} onChange={(v) => set(i, { unit_price: v })} />
          </Field>
          <span className="flex min-h-tap items-center justify-end text-sm">
            <Money value={lineAmount(l)} negLabel="less" />
          </span>
          <span className="flex min-h-tap items-center justify-end">
            {lines.length > 1 && <IconButton icon="trash" label={`Remove Item ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))} />}
          </span>
        </div>
      ))}
      <span className="flex flex-wrap items-center justify-between gap-2">
        {lines.length < max ? (
          <Button size="sm" icon="plus" onClick={() => onChange([...lines, { ...EMPTY_LINE }])}>
            Add Line
          </Button>
        ) : (
          <span />
        )}
        <b className="text-sm">
          Total <Money value={linesTotal(lines)} />
        </b>
      </span>
    </div>
  );
}
