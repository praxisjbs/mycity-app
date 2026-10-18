/**
 * Home is on the contract (packages/contract/schemas/dashboard.js, alerts.js, reports.js) and
 * its screens are typed from contract.gen.ts. What is left here is one INTERIM shape other
 * modules' INTERIM types still share: a bar of a bar list. It goes with the last of them.
 */
export interface BarRow {
  label: string;
  pct: number;
  value: string;
  /** "warn" draws the bar in the warning series, "brand" in yellow. */
  emphasis?: "warn" | "brand";
}
