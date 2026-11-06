/**
 * Recruitment · Offers (M5, owner AJ; INTERIM until M5 puts it on the contract): offers drafted,
 * sent to sign, signed or declined, with the letter beside the list. Moved out of index.tsx unchanged.
 */
import { useState } from "react";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/recruitment";
import type { OfferRow } from "@/api/types/recruitment";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Letter } from "@/features/shared/Letter";
import { PagedTable } from "@/features/shared/sections";
import { paging } from "@/features/shared/wire";
import { Button, Card, cn, DateField, Field, FormFooter, ListDetail, LoadingRows, Money, MoneyField, PageHeader, SelectField, StatusPill, toast, todayIso, useContractForm, useModal, useSideBySide } from "@mycity/ui";
import { say as fail } from "./shared";

export function Offers() {
  const modal = useModal();
  const s = useApi("GET /api/v1/recruitment/offers/summary");
  const list = usePaged("GET /api/v1/recruitment/offers");
  const beside = useSideBySide();
  const [sel, setSel] = useState<OfferRow | null>(null);
  // Beside the list the first offer shows unasked; elsewhere one opens when it is pressed (F31).
  const shown = sel ?? (beside ? (list.rows[0] ?? null) : null);
  const letter = useApi("GET /api/v1/recruitment/offers/:id/letter", { params: { id: shown?.offer_id ?? "" }, enabled: !!shown });
  const send = useMutation("POST /api/v1/recruitment/offers/:id/send");
  return (
    <>
      <PageHeader title="Offers" sub="Generated, sent, signed" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Offer", body: (close) => <OfferForm close={close} /> })}>New Offer</Button>} />
      {s.data && <KpiTiles items={[{ label: "Awaiting Signature", value: String(s.data.awaiting_signature), tone: s.data.awaiting_signature ? "warn" : undefined }, { label: "Signed, This Year", value: String(s.data.signed_this_year), tone: "ok" }, { label: "Declined", value: String(s.data.declined) }, { label: "Average Time to Sign", value: s.data.average_days_to_sign }]} />}
      <ListDetail
        cols="1/1.5"
        full
        open={sel !== null}
        onClose={() => setSel(null)}
        title="Offer Letter"
        list={
          <PagedTable<OfferRow>
            title="Offers"
            list={list}
            rowKey={(o) => o.offer_id}
            noun="offer"
            onRowClick={setSel}
            columns={[
              { key: "c", label: "Candidate", render: (o) => <span className={cn(o.offer_id === shown?.offer_id && "font-semibold")}>{o.candidate}</span> },
              { key: "m", label: "Salary", align: "n", render: (o) => <Money value={o.salary} /> },
              { key: "s", label: "Status", render: (o) => <StatusPill s={o.status} /> },
            ]}
          />
        }
        detail={
          <div>
            {letter.data ? <Letter l={letter.data} note={`Offer letter ${letter.data.reference}, generated from the template and the vacancy.`} /> : <Card><LoadingRows count={6} /></Card>}
            {shown?.status.text === "Draft" && (
              <div className="mt-2 flex justify-end">
                <Button variant="primary" icon="send" busy={send.pending} onClick={async () => { try { await send.run({ params: { id: shown.offer_id }, body: {} }); invalidate("/api/v1/recruitment/offers"); toast(`${shown.number} sent to ${shown.candidate} to sign`); } catch (e) { fail(e); } }}>Send to Sign</Button>
              </div>
            )}
          </div>
        }
      />
    </>
  );
}

function OfferForm({ close }: { close: () => void }) {
  const cands = useInfinite("GET /api/v1/recruitment/candidates", { filters: { stage: "interview" } });
  const f = useContractForm({ candidate_id: "", salary: "", start_date: "", expires_on: "" }, { candidate_id: (v) => (!v ? "Pick the candidate" : null), salary: (v) => (!(Number(v) > 0) ? "Enter the salary" : null), start_date: (v) => (!v ? "Pick the start date" : null), expires_on: (v) => (!v ? "Pick when it expires" : null) });
  const save = useMutation("POST /api/v1/recruitment/offers");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const o = await save.run({ body: f.values });
      invalidate("/api/v1/recruitment/offers");
      close();
      toast(`${o.number} drafted. Review it, then send to sign`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Candidate" {...f.field("candidate_id")}><SelectField placeholder="Interviewed candidate" options={cands.rows.map((c) => [c.candidate_id, `${c.name} · ${c.vacancy.title}`])} {...paging(cands)} {...f.field("candidate_id")} /></Field>
      <Field label="Gross Monthly Salary" {...f.field("salary")}><MoneyField {...f.field("salary")} /></Field>
      <Field label="Start Date" {...f.field("start_date")}><DateField {...f.field("start_date")} min={todayIso()} /></Field>
      <Field label="Offer Expires" {...f.field("expires_on")}><DateField {...f.field("expires_on")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Draft Offer</Button>
      </FormFooter>
    </>
  );
}
