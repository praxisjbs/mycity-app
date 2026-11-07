import type { DealReturn, DealRow } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarChart, Button, DataView, EmptyState, FilterSelect, formatMoney, formatMoneyShort, formatMonth, Pill, todayIso, useModal } from "@mycity/ui";
import { ReturnsForm } from "./forms/ReturnsForm";

/** The figures summed over the year's months; a year is at most twelve, so it is always one page of the list. */
function totalsOf(rows: DealReturn[]) {
  const sum = (k: "gross_sales" | "mycity_commission" | "paid_to_partner") => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0).toFixed(2);
  return {
    commission: sum("mycity_commission"),
    gross: sum("gross_sales"),
    units: rows.reduce((n, r) => n + (r.units_sold ?? 0), 0),
    downloads: rows.reduce((n, r) => n + (r.downloads ?? 0), 0),
  };
}

/**
 * The Partner 360's Returns tab (docs/guides/partnerships.md §6.14, §10.1), shown with
 * `partnerships.money`: a deal's months as a table, a chart of MyCity's commission by month and the
 * year's totals, with Enter Returns a month at a time. Imported months say so.
 */
export function ReturnsTab({ deals, readOnly }: { deals: DealRow[]; readOnly: boolean }) {
  const modal = useModal();
  const signed = deals.filter((d) => d.status === "live" || d.status === "completed");
  const choices = signed.length ? signed : deals;
  const [dealId, setDealId] = useState(choices[0]?.deal_id ?? "");
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const list = usePaged("GET /api/v1/partnerships/deals/:id/returns", { params: { id: dealId }, filters: { year: Number(year) }, enabled: Boolean(dealId) });
  if (!choices.length) return <EmptyState title="No Deals Yet" text="Returns follow a signed deal." />;
  const enter = (held?: DealReturn) => modal.open({ title: "Enter Returns", body: (close) => <ReturnsForm dealId={dealId} held={held ?? null} close={close} /> });
  const totals = totalsOf(list.rows);
  const chronological = [...list.rows].reverse();
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        {choices.length > 1 && <FilterSelect label="Deal" value={dealId} onChange={setDealId} options={choices.map((d) => [d.deal_id, d.title] as [string, string])} />}
        <FilterSelect label="Year" value={year} onChange={setYear} options={[0, 1, 2].map((n) => [String(thisYear - n), String(thisYear - n)] as [string, string])} />
        {!readOnly && (
          <Button variant="primary" icon="plus" className="ml-auto" onClick={() => enter()}>
            Enter Returns
          </Button>
        )}
      </div>
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Commission", value: formatMoneyShort(totals.commission) },
          { label: "Gross Sales", value: formatMoneyShort(totals.gross) },
          { label: "Units Sold", value: totals.units.toLocaleString("en-NG") },
          { label: "Downloads", value: totals.downloads.toLocaleString("en-NG") },
        ]}
      />
      {chronological.length > 0 && (
        <BarChart title="Commission by Month" bars={chronological.map((r) => ({ label: formatMonth(r.month.slice(0, 7)), value: Number(r.mycity_commission ?? 0) }))} format={(n) => formatMoneyShort(n.toFixed(2))} />
      )}
      <DataView<DealReturn>
        title="Months"
        rows={list.rows}
        page={list.page}
        onPage={list.setPage}
        loading={list.loading}
        rowKey={(r) => r.deal_return_id}
        onRowClick={readOnly ? undefined : (r) => enter(r)}
        empty={{ title: "No Returns Yet", text: "Enter a month, or import the report." }}
        columns={[
          { key: "m", label: "Month", render: (r) => formatMonth(r.month.slice(0, 7)) },
          { key: "u", label: "Units Sold", align: "n", render: (r) => (r.units_sold ?? 0).toLocaleString("en-NG"), desktop: true },
          { key: "g", label: "Gross Sales", align: "n", render: (r) => (r.gross_sales ? formatMoney(r.gross_sales) : "None"), desktop: true },
          { key: "c", label: "Commission", align: "n", render: (r) => (r.mycity_commission ? formatMoney(r.mycity_commission) : "None") },
          { key: "p", label: "Paid to Partner", align: "n", render: (r) => (r.paid_to_partner ? formatMoney(r.paid_to_partner) : "None"), desktop: true },
          { key: "d", label: "Downloads", align: "n", render: (r) => (r.downloads ?? 0).toLocaleString("en-NG") },
          { key: "s", label: "Source", render: (r) => (r.source === "import" ? <Pill>Imported</Pill> : <Pill tone="neutral">Entered</Pill>), desktop: true },
        ]}
      />
    </>
  );
}
