import type { DealReturn } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { useState } from "react";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, Field, formatMonth, FormFooter, MoneyField, NumberField, SelectField, TextField, toast, todayIso, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/** The last eighteen months, newest first, as `YYYY-MM`: the months a return is entered for. */
export function recentMonths(today = todayIso()): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
const int = (v: string) => (v.trim() === "" ? undefined : Number(v));

/**
 * Enter Returns (docs/guides/partnerships.md §6.14), with `partnerships.money`: a deal's month at a
 * time, its units sold, gross sales, MyCity's commission, paid to the partner, downloads and a note,
 * checked by ReturnSave as they are filled. A month saved again replaces what it held.
 */
export function ReturnsForm({ dealId, held, close }: { dealId: string; held?: DealReturn | null; close: () => void }) {
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
    pipeline.ReturnSave,
  );
  const save = useMutation("PUT /api/v1/partnerships/deals/:id/returns/:month");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    const body = {
      units_sold: int(v.units_sold),
      downloads: int(v.downloads),
      ...(v.gross_sales ? { gross_sales: v.gross_sales } : {}),
      ...(v.mycity_commission ? { mycity_commission: v.mycity_commission } : {}),
      ...(v.paid_to_partner ? { paid_to_partner: v.paid_to_partner } : {}),
      ...(v.note.trim() ? { note: v.note.trim() } : {}),
    };
    try {
      await save.run({ params: { id: dealId, month }, body });
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
      <Field label="Gross Sales" optional {...f.status("gross_sales")}><MoneyField {...f.field("gross_sales")} /></Field>
      <Field label="MyCity Commission" optional {...f.status("mycity_commission")}><MoneyField {...f.field("mycity_commission")} /></Field>
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
