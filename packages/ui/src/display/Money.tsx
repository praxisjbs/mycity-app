/**
 * @component Money
 * @group Display
 * @summary An amount as people read it, from the wire string: ₦1,250,000.00 with kobo and tabular figures; a negative carries a minus sign, colour and a word.
 * @use Every amount on a screen: a table cell, a payslip line, a KPI (short), a record's field.
 * @avoid Formatting money by hand or through a float; ₦1.3M anywhere but a KPI tile; colour alone for a negative.
 * @phone The same; it never wraps inside the amount.
 * @a11y Text, not an image: the minus sign and the word (deduction) are read, so a negative never depends on colour. An amount that is not set shows EmptyValue.
 * @status stable
 * @example <Money value="1250000.00" />
 * @example <Money value="-45000.00" negLabel="refund" />
 * @example <Money value={kpi.total} short />
 */
import { cn } from "../lib/cn";
import { formatMoney, formatMoneyShort, isNegative } from "../lib/format";
import { EmptyValue } from "./EmptyValue";

export interface MoneyProps {
  /** The amount as the API sends it, a decimal string ("1250000.00"); null or "" shows EmptyValue. */
  value: string | null | undefined;
  /** The short form (₦1.3M), for KPI tiles only. */
  short?: boolean;
  /** Drop the kobo (₦1,250,000), for whole-Naira figures such as a salary band. */
  kobo?: boolean;
  /** The word after a negative amount, lower case; "deduction" unless set. */
  negLabel?: string;
  /** Layout classes only (alignment, size). */
  className?: string;
}

export function Money({ value, short, kobo = true, negLabel = "deduction", className }: MoneyProps) {
  if (value == null || value === "") return <EmptyValue label="No amount" className={className} />;
  const neg = isNegative(value);
  return (
    <span data-money="" data-negative={neg || undefined} className={cn("whitespace-nowrap tabular-nums", neg && "text-destructive", className)}>
      {short ? formatMoneyShort(value) : formatMoney(value, { kobo })}
      {neg && <span className="ml-1 text-2xs font-semibold">({negLabel})</span>}
    </span>
  );
}
