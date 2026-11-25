import type { DealReturn } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { useRef, useState } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, Field, formatMonth, FormFooter, MoneyField, NumberField, SelectField, TextField, toast, todayIso, toMoneyString, useContractForm } from "@mycity/ui";
import { failed, useCategoryDefaults } from "../lib";
import { checkedOnWire, countOnWire, moneyOnWire } from "./parts";

/** The last eighteen months, newest first, as `YYYY-MM`: the months a return is entered for. */
export function recentMonths(today = todayIso()): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

type Typed = { units_sold: string; gross_sales: string; mycity_commission: string; paid_to_partner: string; downloads: string; note: string };
const MONEY = ["gross_sales", "mycity_commission", "paid_to_partner"] as const;

/** The month as ReturnSave takes it: counts as numbers, amounts to two places, empty figures left out. */
export function returnsOnWire(v: Typed): Record<string, unknown> {
  const out: Record<string, unknown> = { units_sold: countOnWire(v.units_sold), downloads: countOnWire(v.downloads) };
  for (const k of MONEY) if (v[k].trim()) out[k] = moneyOnWire(v[k]);
  if (v.note.trim()) out.note = v.note.trim();
  return out;
}

/**
 * MyCity's commission suggested for a month's gross sales at a rate in percent (§6.14, QA F61b): to the
 * kobo, half a kobo up, in whole-number arithmetic so no amount is rounded through a float. Empty when
 * either is missing or not a figure.
 */
export function suggestCommission(gross: string, rate: string | null | undefined): string {
  const amount = toMoneyString(gross);
  const pct = String(rate ?? "").trim();
  if (!/^\d+\.\d{2}$/.test(amount) || !/^\d+(\.\d{1,4})?$/.test(pct)) return "";
  const kobo = BigInt(amount.replace(".", ""));
  const [w, f = ""] = pct.split(".");
  const scaled = BigInt(w + (f + "0000").slice(0, 4)); // the rate times 10,000
  const out = (kobo * scaled + 500000n) / 1000000n; // kobo times the rate, over 100 and 10,000
  const text = out.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/**
 * Enter Returns (docs/guides/partnerships.md §6.14), with `partnerships.money`: a deal's month at a
 * time, its units sold, gross sales, MyCity's commission, paid to the partner, downloads and a note,
 * checked by ReturnSave as they are filled. A month saved again replaces what it held. MyCity
 * Commission follows Gross Sales at the deal's rate (its category's default when the deal has none)
 * until the person types their own (QA F61b).
 */
export function ReturnsForm({ dealId, categoryId, held, close }: { dealId: string; categoryId?: string | null; held?: DealReturn | null; close: () => void }) {
  const months = recentMonths();
  const [month, setMonth] = useState(held ? held.month.slice(0, 7) : months[0]);
  const f = useContractForm(
    {
      units_sold: str(held?.units_sold),
      gross_sales: held?.gross_sales ?? "",
      mycity_commission: held?.mycity_commission ?? "",
      paid_to_partner: held?.paid_to_partner ?? "",
      downloads: str(held?.downloads),
      note: held?.note ?? "",
    },
    checkedOnWire(pipeline.ReturnSave, returnsOnWire),
  );
  const deal = useApi("GET /api/v1/partnerships/deals/:id", { params: { id: dealId } });
  const category = useCategoryDefaults(categoryId);
  const rate = deal.data?.commission_pct ?? category?.commission ?? null;
  // The commission follows the gross while it is empty or still the suggestion; typed by hand, it stays.
  const own = useRef(Boolean(held?.mycity_commission));
  const gross = f.field("gross_sales");
  const commission = f.field("mycity_commission");
  const onGross = (v: string) => {
    gross.onChange(v);
    if (!own.current) f.set("mycity_commission", suggestCommission(v, rate));
  };
  const onCommission = (v: string) => {
    own.current = v.trim() !== "";
    commission.onChange(v);
  };
  const save = useMutation("PUT /api/v1/partnerships/deals/:id/returns/:month");
  const submit = async () => {
    if (!f.check()) return;
    const body = returnsOnWire(f.values);
    try {
      await save.run({ params: { id: dealId, month }, body: body as never });
      invalidate("/api/v1/partnerships");
      close();
      toast("Returns saved");
    } catch (e) {
      failed(f)(e);
    }
  };
  const options: Array<[string, string]> = (held && !months.includes(month) ? [month, ...months] : months).map((m) => [m, formatMonth(m)]);
  return (
    <>
      <Field label="Month">
        <SelectField value={month} onChange={setMonth} options={options} />
      </Field>
      <Field label="Units Sold" optional {...f.status("units_sold")}><NumberField {...f.field("units_sold")} /></Field>
      <Field label="Gross Sales" optional {...f.status("gross_sales")}><MoneyField {...gross} onChange={onGross} /></Field>
      <Field
        label="MyCity Commission"
        optional
        help={rate ? `Suggested at ${Number(rate)}% of gross sales. Change it if the month differs.` : undefined}
        {...f.status("mycity_commission")}
      >
        <MoneyField {...commission} onChange={onCommission} />
      </Field>
      <Field label="Paid to Partner" optional {...f.status("paid_to_partner")}><MoneyField {...f.field("paid_to_partner")} /></Field>
      <Field label="Downloads" optional {...f.status("downloads")}><NumberField {...f.field("downloads")} /></Field>
      <Field label="Note" optional {...f.status("note")}><TextField {...f.field("note")} placeholder="Early bird week" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Returns</Button>
      </FormFooter>
    </>
  );
}
