import { cn } from "@/lib/cn";
import { formatMoney, formatMoneyShort, isNegative } from "@/lib/format";

/**
 * An amount as people read it: ₦1,250,000.00, right-aligned in tables, tabular
 * figures. A negative amount carries a minus sign, colour AND a label, never
 * colour alone (FRONTEND_GUIDE §6). `short` is for KPI tiles only.
 */
export function Money({ value, short, negLabel = "deduction", className }: { value: string | null | undefined; short?: boolean; negLabel?: string; className?: string }) {
  if (value == null || value === "") return <span className="text-subtle-foreground">None</span>;
  const neg = isNegative(value);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", neg && "text-destructive", className)}>
      {short ? formatMoneyShort(value) : formatMoney(value)}
      {neg && <span className="ml-1 text-[11px] font-semibold">({negLabel})</span>}
    </span>
  );
}
