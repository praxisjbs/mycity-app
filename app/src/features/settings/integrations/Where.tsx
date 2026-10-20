import type { IntegrationRow } from "@mycity/contract/contract.gen.ts";
import { formatCount, HelpTerm } from "@mycity/ui";
import { HELP, PROBLEM, SOURCE } from "./words";

/** Where a connection's settings come from, or what is wrong when it is failing. */
export function Where({ row }: { row: Pick<IntegrationRow, "state" | "source" | "last_error_code"> }) {
  if (row.state === "failing" && row.last_error_code) return <span className="text-destructive">{PROBLEM[row.last_error_code]}</span>;
  if (row.source === "file") return <HelpTerm help={HELP.file}>{SOURCE.file}</HelpTerm>;
  return <span>{SOURCE[row.source]}</span>;
}

/** Today's use against the daily limit: "120 of 3,000", or the count alone. */
export function todayOf(r: Pick<IntegrationRow, "units_today" | "daily_limit">) {
  const used = formatCount(Math.round(r.units_today));
  return r.daily_limit ? `${used} of ${formatCount(r.daily_limit)}` : used;
}
