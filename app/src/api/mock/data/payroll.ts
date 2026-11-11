import { sid } from "../core";
import { PEOPLE, type MockPerson } from "./people";

/**
 * Demonstration payslips: one per person per month from their start date,
 * up to last month, plus this month "in the run". The mock computes amounts
 * as a backend would (in kobo, integers); the screens only ever see strings.
 */
const k = (naira: string) => Math.round(Number(naira) * 100);
const s = (kobo: number) => `${Math.trunc(kobo / 100)}.${String(Math.abs(kobo % 100)).padStart(2, "0")}`;

export const DEDUCTION_EVENTS: Record<string, Array<{ period: string; amount: number; reason: string; query: string }>> = {
  bashir: [{ period: "-2", amount: 1250000, reason: "Repeated lateness, August", query: "QRY-0011" }],
  cynthia: [{ period: "-2", amount: 1250000, reason: "Repeated lateness, August", query: "QRY-0011" }, { period: "-19", amount: 750000, reason: "Missing clock-outs, March", query: "QRY-0004" }],
  obinna: [{ period: "-5", amount: 500000, reason: "Unauthorised absence", query: "QRY-0007" }],
};

function periodOffset(offset: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}

export interface MockSlip {
  payslip_id: string;
  number: string;
  person: MockPerson;
  period: string;
  gross: number;
  ded: number;
  status: "paid" | "in_run";
  paid_on: string | null;
  ded_reason: string | null;
  ded_query: string | null;
}

export const SLIPS: MockSlip[] = (() => {
  const out: MockSlip[] = [];
  PEOPLE.forEach((p, idx) => {
    const start = p.start_date.slice(0, 7);
    for (let off = 0; off >= -30; off -= 1) {
      const period = periodOffset(off);
      if (period < start) break;
      const ev = DEDUCTION_EVENTS[p.user_key]?.find((e) => periodOffset(Number(e.period)) === period);
      const gross = k(p.gross_monthly) - (off < -12 ? Math.round(k(p.gross_monthly) * 0.12) : 0);
      out.push({
        payslip_id: sid(`slip:${p.user_key}:${period}`),
        number: `PAY-${period}-${String(idx + 1).padStart(4, "0")}`,
        person: p,
        period,
        gross,
        ded: ev?.amount ?? 0,
        status: off === 0 ? "in_run" : "paid",
        paid_on: off === 0 ? null : payDateOf(period),
        ded_reason: ev?.reason ?? null,
        ded_query: ev?.query ?? null,
      });
    }
  });
  return out;
})();

export const money = s;
export const kobo = k;

/**
 * A month's pay date: the pay day (30 unless MyCity sets another), held to the month's last day, so 30
 * pays on 28 or 29 February (docs/guides/payroll.md §6.11 rule 1). `period` is YYYY-MM.
 */
export function payDateOf(period: string, payDay = 30): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(Math.min(payDay, last)).padStart(2, "0")}`;
}
