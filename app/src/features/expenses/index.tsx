import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/expenses";
import type { Category, Disbursement, ExpenseRow, Requisition } from "@/api/types/expenses";
import type { DocumentRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { AreaChart } from "@/components/ui/charts";
import { Chain, KV, Quote, Who } from "@/components/ui/data";
import { Icon } from "@/components/ui/Icon";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";
import { ErrorBlock, LoadingRows, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate, formatDateTime, formatMoneyShort, todayIso } from "@/lib/format";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ExportButton, KvCard, ModalFoot, PagedTable, StatusPill, TrailCard } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AmountInput, DateField, Field, FormRow, Input, Select, Textarea, Upload, useForm } from "@/components/form";

export default function Expenses({ tab, id }: ModuleScreenProps) {
  if (tab === "approvals") return <Approvals id={id} />;
  if (tab === "requisitions") return <Requisitions />;
  if (tab === "disbursements") return <Disbursements />;
  if (tab === "budgets") return <BudgetsTab />;
  if (tab === "categories") return <Categories />;
  return <MyRequests id={id} />;
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");
/** The beneficiary's bank, as the transfer will name it. */
const BANKS = ["Access Bank", "First Bank", "GTBank", "Providus Bank", "Stanbic IBTC", "UBA", "Wema Bank", "Zenith Bank"].map((b) => [b, b] as [string, string]);

/* ───────────── My requests ───────────── */

function MyRequests({ id }: { id: string | null }) {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/mine/summary");
  const list = usePaged("GET /api/v1/expenses/requests", { filters: { scope: "mine" } });
  const [sel, setSel] = useState<string | null>(id);
  const focus = sel ?? s.data?.focus_id ?? null;
  return (
    <>
      <PageHead title="My Requests" sub="Your own expense requests" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Request", wide: true, body: (close) => <RequestForm close={close} /> })}>New Request</Button>} />
      {s.data && <KpiTiles items={[{ label: "In Flight", value: String(s.data.in_flight), tone: s.data.in_flight ? "warn" : undefined }, { label: "Disbursed This Year", value: formatMoneyShort(s.data.disbursed_this_year) }, { label: "Average Turnaround", value: s.data.average_turnaround }, { label: "Rejected", value: String(s.data.rejected), tone: s.data.rejected ? "err" : "ok" }]} />}
      {focus && <FocusChain id={focus} />}
      <PagedTable<ExpenseRow>
        title="My Requests"
        list={list}
        search="Search requests"
        rowKey={(r) => r.request_id}
        noun="request"
        onRowClick={(r) => setSel(r.request_id)}
        empty={{ title: "No requests yet", text: "Raise one with New Request. It goes to your line manager first." }}
        columns={[
          { key: "n", label: "Reference", render: (r) => <span className={cn(r.request_id === focus && "font-semibold")}>{r.number}</span> },
          { key: "t", label: "Description", render: (r) => r.title },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
          { key: "d", label: "Submitted", render: (r) => formatDate(r.submitted_at), desktop: true },
          { key: "s", label: "Stage", render: (r) => <StatusPill s={r.stage_status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <KvCard
          title="What a Request Needs"
          items={[
            ["Description", "What it is for, in a sentence"],
            ["Amount", "In Naira. Always"],
            ["Category", "From the category list"],
            ["Vendor invoice", "Attached. The engine compresses it on the way up"],
            ["Account details", "Beneficiary bank and account, for the disbursement"],
            ["Project", "Optional. Links the spend to a campaign or a city"],
          ]}
        />
        {focus ? <History id={focus} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function FocusChain({ id }: { id: string }) {
  const d = useApi("GET /api/v1/expenses/requests/:id", { params: { id } });
  if (!d.data) return null;
  return (
    <Card className="mb-3">
      <Chain steps={d.data.chain.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />
      <p className="mt-[11px] text-[11.5px] text-subtle-foreground">{d.data.number}, {d.data.title.toLowerCase()}. {d.data.chain_note}</p>
    </Card>
  );
}

function History({ id }: { id: string }) {
  const d = useApi("GET /api/v1/expenses/requests/:id", { params: { id } });
  if (!d.data) return <Card>{d.error ? <ErrorBlock error={d.error} /> : <LoadingRows />}</Card>;
  return <TrailCard title={`${d.data.number} History`} items={d.data.history.map((h) => ({ ...h, when: formatDateTime(h.when) }))} />;
}

function RequestForm({ close }: { close: () => void }) {
  const cats = usePaged("GET /api/v1/expenses/categories");
  const { me } = useAuth();
  const [invoice, setInvoice] = useState<DocumentRef | null>(null);
  const [tried, setTried] = useState(false);
  const f = useForm({ title: "", category_id: "", amount: "", project: "", beneficiary_name: me?.display_name ?? "", bank: "", account_number: "" }, {
    title: (v) => (v.trim().length < 6 ? "What it is for, in a sentence" : null),
    category_id: (v) => (!v ? "Pick the category" : null),
    amount: (v) => (!(Number(v) > 0) ? "Enter the amount in Naira" : null),
    beneficiary_name: (v) => (!v.trim() ? "Who is paid" : null),
    bank: (v) => (!v ? "Pick the bank" : null),
    account_number: (v) => (!/^\d{10}$/.test(v) ? "Ten digits (NUBAN)" : null),
  });
  const save = useMutation("POST /api/v1/expenses/requests");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !invoice) return;
    try {
      const r = await save.run({ body: { ...f.values, invoice_document_id: invoice.document_id, ...(f.values.project ? {} : { project: undefined }) } });
      invalidate("/api/v1/expenses");
      close();
      toast(`${r.number} sent to your line manager`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Description" {...f.field("title")}><Input {...f.field("title")} placeholder="Courier to Enugu" /></Field>
      <FormRow>
        <Field label="Category" {...f.field("category_id")}><Select placeholder="Pick one" options={cats.rows.map((c) => [c.category_id, c.name])} {...f.field("category_id")} /></Field>
        <Field label="Amount" {...f.field("amount")}><AmountInput {...f.field("amount")} /></Field>
      </FormRow>
      <Field label="Project (Optional)"><Input {...f.field("project")} placeholder="Campaign or city" /></Field>
      <FormRow>
        <Field label="Beneficiary" {...f.field("beneficiary_name")}><Input {...f.field("beneficiary_name")} /></Field>
        <Field label="Bank" {...f.field("bank")}><Select placeholder="Pick the bank" options={BANKS} {...f.field("bank")} /></Field>
      </FormRow>
      <Field label="Account Number" {...f.field("account_number")}><Input {...f.field("account_number")} inputMode="numeric" onChange={(v) => f.set("account_number", v.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" /></Field>
      <Field label="Vendor Invoice" state={tried && !invoice ? "bad" : undefined} message={tried && !invoice ? "Attach the invoice" : undefined}>
        {invoice ? (
          <span className="flex items-center gap-2 rounded-ctl border border-border bg-muted px-3 py-2 text-[12.5px]"><Icon name="doc" />{invoice.file_name}<span className="text-subtle-foreground">{formatBytes(invoice.size_bytes)}</span><button type="button" className="ml-auto text-accent-foreground underline" onClick={() => setInvoice(null)}>Replace</button></span>
        ) : (
          <Upload purpose="expense_invoice" accept=".pdf,image/*" multiple={false} compact onUploaded={(d) => setInvoice(d[0])} />
        )}
      </Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" disabled={save.pending} onClick={submit}>Submit Request</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Approvals ───────────── */

function Approvals({ id }: { id: string | null }) {
  const s = useApi("GET /api/v1/expenses/approvals/summary");
  const list = usePaged("GET /api/v1/expenses/requests", { filters: { scope: "approvals" } });
  const [sel, setSel] = useState<string | null>(id);
  const focus = sel ?? s.data?.focus_id ?? null;
  return (
    <>
      <PageHead title="Approvals" sub="Requests waiting on you" />
      {s.data && <KpiTiles items={[{ label: "With You", value: String(s.data.with_you), tone: s.data.with_you ? "warn" : "ok" }, { label: "Total Value", value: formatMoneyShort(s.data.total_value) }, { label: "Oldest", value: `${s.data.oldest_days} days` }, { label: "Approved This Month", value: String(s.data.approved_this_month), tone: "ok" }]} />}
      {focus && <ApprovalCard id={focus} onDone={() => setSel(null)} />}
      <PagedTable<ExpenseRow>
        title="Queue"
        list={list}
        rowKey={(r) => r.request_id}
        noun="request"
        onRowClick={(r) => setSel(r.request_id)}
        empty={{ title: "Nothing waiting on you", text: "Requests reach you as line manager or as Operations." }}
        columns={[
          { key: "n", label: "Reference", render: (r) => <span className={cn(r.request_id === focus && "font-semibold")}>{r.number}</span> },
          { key: "t", label: "Description", render: (r) => r.title },
          { key: "r", label: "Requester", render: (r) => <Who name={r.requester.display_name} sub={r.requester.department ?? undefined} />, desktop: true },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
          { key: "s", label: "Stage", render: () => <StatusPill s={{ tone: "warn", text: "With you" }} /> },
        ]}
      />
    </>
  );
}

function ApprovalCard({ id, onDone }: { id: string; onDone: () => void }) {
  const modal = useModal();
  const d = useApi("GET /api/v1/expenses/requests/:id", { params: { id } });
  const approve = useMutation("POST /api/v1/expenses/requests/:id/approve");
  if (!d.data) return <Card className="mb-3">{d.error ? <ErrorBlock error={d.error} /> : <LoadingRows />}</Card>;
  const x = d.data;
  return (
    <Card className="mb-3">
      <CardHeader title={`${x.number} · ${x.title}`} right={<StatusPill s={{ tone: "warn", text: formatMoneyShort(x.amount) }} />} />
      <Chain steps={x.chain.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />
      <p className="mt-[11px] text-[11.5px] text-subtle-foreground">{x.chain_note} Vendor invoice attached, account details supplied.</p>
      <div className="mt-[13px]">
        <KV
          items={[
            ["Requested by", `${x.requester.display_name}, ${x.requester.job_title ?? x.requester.department ?? ""}`],
            ["Category", x.category],
            ["Beneficiary", `${x.beneficiary.name} · ${x.beneficiary.bank} · ••••${x.beneficiary.account_last4}`],
            ["Invoice", x.invoice ? `${x.invoice.file_name} · ${formatBytes(x.invoice.size_bytes)}` : "None"],
            ["Project", x.project ?? "None"],
          ]}
        />
      </div>
      {x.can_approve && (
        <div className="mt-[13px] flex flex-wrap gap-2">
          <Button variant="primary" icon="ok" disabled={approve.pending} onClick={async () => { try { await approve.run({ params: { id }, body: {} }); invalidate("/api/v1/expenses"); onDone(); toast(`${x.number} approved`); } catch (e) { fail(e); } }}>Approve as {x.approve_as}</Button>
          <Button onClick={() => modal.open({ title: `Reject ${x.number}`, body: (close) => <Reject id={id} close={close} onDone={onDone} /> })}>Reject</Button>
          {x.invoice && <Button icon="doc" onClick={() => toast(`${x.invoice!.file_name} opens from the vault once connected`)}>View Invoice</Button>}
        </div>
      )}
    </Card>
  );
}

function Reject({ id, close, onDone }: { id: string; close: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const reject = useMutation("POST /api/v1/expenses/requests/:id/reject");
  return (
    <>
      <Field label="Reason" info="The requester sees this.">
        <Textarea value={reason} onChange={setReason} placeholder="Use approved vendors" />
      </Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={reason.trim().length < 6 || reject.pending} onClick={async () => { try { await reject.run({ params: { id }, body: { reason } }); invalidate("/api/v1/expenses"); close(); onDone(); toast("Rejected. The requester is told why"); } catch (e) { fail(e); } }}>Reject</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Requisitions ───────────── */

function Requisitions() {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/requisitions/summary");
  const list = usePaged("GET /api/v1/expenses/requisitions");
  const [sel, setSel] = useState<string | null>(null);
  const focus = sel ?? s.data?.focus_id ?? null;
  return (
    <>
      <PageHead title="Requisitions" sub="Approved requests grouped for the CEO" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Requisition", wide: true, body: (close) => <NewRequisition close={close} /> })}>New Requisition</Button>} />
      {s.data && <KpiTiles items={[{ label: "With the CEO", value: String(s.data.with_ceo), tone: s.data.with_ceo ? "err" : "ok" }, { label: "Days Waiting", value: String(s.data.days_waiting), tone: s.data.days_waiting > 3 ? "err" : undefined }, { label: "Disbursed This Year", value: formatMoneyShort(s.data.disbursed_this_year) }, { label: "Average Size", value: s.data.average_size }]} />}
      <p className="mb-3 text-[11.5px] text-subtle-foreground">Operations selects approved requests and submits them as one requisition. The CEO approves the requisition, not each request.</p>
      <PagedTable<Requisition>
        title="Requisitions"
        list={list}
        rowKey={(r) => r.requisition_id}
        noun="requisition"
        onRowClick={(r) => setSel(r.requisition_id)}
        columns={[
          { key: "n", label: "Reference", render: (r) => <span className={cn(r.requisition_id === focus && "font-semibold")}>{r.number}</span> },
          { key: "c", label: "Requests", align: "n", render: (r) => r.count },
          { key: "t", label: "Total", align: "n", render: (r) => <Money value={r.total} /> },
          { key: "s", label: "Submitted", render: (r) => formatDate(r.submitted_on), desktop: true },
          { key: "a", label: "Approved", render: (r) => (r.approved_on ? formatDate(r.approved_on) : "Not yet"), desktop: true },
          { key: "st", label: "Status", render: (r) => <StatusPill s={r.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {focus ? <RequisitionCard id={focus} /> : <Card><LoadingRows /></Card>}
        <Card>
          <CardHeader title="Why Group Them" />
          <p className="text-[11.5px] text-subtle-foreground">The CEO was approving requests one at a time, which meant five notifications for one afternoon of spending and no view of the total.</p>
          <p className="mt-[9px] text-[11.5px] text-subtle-foreground">A requisition is one decision on one number, with the requests visible underneath it.</p>
          <Quote className="mt-3">An open requisition ages like any approval. The ageing rule raises an alert after three days.</Quote>
          <div className="mt-3.5">
            <KV items={[["Who groups", "Operations"], ["Who approves", "The CEO. One decision"], ["Partial approval", "Possible. A removed request returns to the queue"], ["After approval", "Each request becomes disbursable on its own"]]} />
          </div>
        </Card>
      </Grid>
    </>
  );
}

function RequisitionCard({ id }: { id: string }) {
  const d = useApi("GET /api/v1/expenses/requisitions/:id", { params: { id } });
  const approve = useMutation("POST /api/v1/expenses/requisitions/:id/approve");
  const [removed, setRemoved] = useState<string[]>([]);
  if (!d.data) return <Card>{d.error ? <ErrorBlock error={d.error} /> : <LoadingRows />}</Card>;
  const x = d.data;
  const kept = x.items.filter((i) => !removed.includes(i.request_id));
  const total = kept.reduce((a, i) => a + Math.round(Number(i.amount) * 100), 0);
  const totalStr = `${Math.trunc(total / 100)}.${String(total % 100).padStart(2, "0")}`;
  return (
    <Table
      title={`Included in ${x.number}`}
      right={<b className="text-[13px]"><Money value={totalStr} /></b>}
      rows={x.items}
      rowKey={(r) => r.request_id}
      columns={[
        { key: "t", label: "Request", render: (r) => <span className={cn(removed.includes(r.request_id) && "text-subtle-foreground line-through")}>{r.number} · {r.title}</span> },
        { key: "r", label: "Requester", render: (r) => r.requester.display_name, desktop: true },
        { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
        ...(x.can_approve ? [{ key: "x", label: "", render: (r: ExpenseRow) => <Button size="sm" onClick={() => setRemoved((l) => (l.includes(r.request_id) ? l.filter((v) => v !== r.request_id) : [...l, r.request_id]))}>{removed.includes(r.request_id) ? "Keep" : "Remove"}</Button> }] : []),
      ]}
      footer={
        x.can_approve && (
          <div className="flex justify-end border-t border-border px-[14px] py-2.5">
            <Button variant="primary" icon="ok" disabled={!kept.length || approve.pending} onClick={async () => { try { await approve.run({ params: { id }, body: { remove_ids: removed } }); invalidate("/api/v1/expenses"); toast(`${x.number} approved${removed.length ? `, ${removed.length} returned to the queue` : ""}`); } catch (e) { fail(e); } }}>
              Approve {kept.length} of {x.items.length}
            </Button>
          </div>
        )
      }
    />
  );
}

function NewRequisition({ close }: { close: () => void }) {
  const ready = usePaged("GET /api/v1/expenses/requests", { filters: { scope: "all", stage: "requisition" } });
  const [ids, setIds] = useState<string[]>([]);
  const save = useMutation("POST /api/v1/expenses/requisitions");
  const total = ready.rows.filter((r) => ids.includes(r.request_id)).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Requests Operations has approved. Pick the ones to send to the CEO together.</p>
      <Table
        rows={ready.rows}
        rowKey={(r) => r.request_id}
        loading={ready.loading}
        onRowClick={(r) => setIds((l) => (l.includes(r.request_id) ? l.filter((v) => v !== r.request_id) : [...l, r.request_id]))}
        empty={{ title: "Nothing ready", text: "Requests appear here once Operations approves them." }}
        columns={[
          { key: "c", label: "", render: (r) => <span className={cn("flex size-5 items-center justify-center rounded-full border", ids.includes(r.request_id) ? "border-secondary bg-secondary text-secondary-foreground" : "border-input")}>{ids.includes(r.request_id) && <Icon name="check" className="size-3" />}</span> },
          { key: "n", label: "Request", render: (r) => `${r.number} · ${r.title}` },
          { key: "r", label: "Requester", render: (r) => r.requester.display_name, desktop: true },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
        ]}
      />
      <ModalFoot>
        <span className="mr-auto text-[12.5px]">{ids.length} selected · <b><Money value={`${Math.trunc(total / 100)}.${String(total % 100).padStart(2, "0")}`} /></b></span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!ids.length || save.pending} onClick={async () => { try { const q = await save.run({ body: { request_ids: ids } }); invalidate("/api/v1/expenses"); close(); toast(`${q.number} sent to the CEO`); } catch (e) { fail(e); } }}>Send to CEO</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Disbursements ───────────── */

function Disbursements() {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/disbursements/summary");
  const list = usePaged("GET /api/v1/expenses/disbursements");
  return (
    <>
      <PageHead
        title="Disbursements"
        sub="Logged after the bank confirms"
        actions={
          <>
            <ExportButton source="expenses.disbursements" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Log Disbursement", body: (close) => <LogDisbursement close={close} /> })}>Log Disbursement</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Settled This Month", value: formatMoneyShort(s.data.settled_this_month) }, { label: "Awaiting Disbursement", value: String(s.data.awaiting), tone: s.data.awaiting ? "warn" : "ok" }, { label: "Average to Pay", value: s.data.average_days }, { label: "Missing Reference", value: String(s.data.missing_reference), tone: "ok" }]} />}
      <PagedTable<Disbursement>
        title="Disbursements"
        list={list}
        search="Search reference or beneficiary"
        rowKey={(d) => d.disbursement_id}
        noun="disbursement"
        wide
        columns={[
          { key: "n", label: "Reference", render: (d) => <span className="font-semibold">{d.number}</span> },
          { key: "b", label: "Beneficiary", render: (d) => d.beneficiary },
          { key: "k", label: "Bank", render: (d) => d.bank, desktop: true },
          { key: "a", label: "Amount", align: "n", render: (d) => <Money value={d.amount} /> },
          { key: "r", label: "Bank Reference", render: (d) => <span className="font-mono text-[12px]">{d.bank_reference}</span>, desktop: true },
          { key: "d", label: "Date", render: (d) => formatDate(d.paid_on) },
          { key: "s", label: "Status", render: (d) => <StatusPill s={d.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <AreaChart title="Disbursed per Month" values={s.data.trend.values.map(Number)} labels={s.data.trend.labels} note="Naira, settled only. A logged but unsettled transfer does not appear." /> : <Card><LoadingRows /></Card>}
        <KvCard
          title="Why a Bank Reference Is Mandatory"
          items={[
            ["The rule", "A disbursement cannot be saved without one"],
            ["Enforced by", "The database, not only the screen"],
            ["Why", "A disbursement with no reference cannot be traced back to a transfer"],
            ["What it is not", "This system does not move money. It records that money moved"],
            ["Currency", "All transfers in Naira. No multi-currency anywhere"],
            ["Reconciliation", "The reference is what the finance team matches against the statement"],
          ]}
        />
      </Grid>
    </>
  );
}

function LogDisbursement({ close }: { close: () => void }) {
  const ready = usePaged("GET /api/v1/expenses/requests", { filters: { scope: "all", stage: "approved" } });
  const f = useForm({ request_id: "", bank_reference: "", paid_on: todayIso() }, { request_id: (v) => (!v ? "Pick the approved request" : null), bank_reference: (v) => (!/^[A-Z0-9]{8,24}$/.test(v) ? "The bank's transfer reference" : null), paid_on: (v) => (!v ? "The date the bank confirmed" : null) });
  const save = useMutation("POST /api/v1/expenses/disbursements");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const d = await save.run({ body: f.values });
      invalidate("/api/v1/expenses");
      close();
      toast(`${d.number} logged as settled`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Request" {...f.field("request_id")}><Select placeholder={ready.rows.length ? "Pick an approved request" : "Nothing awaiting disbursement"} options={ready.rows.map((r) => [r.request_id, `${r.number} · ${r.title} · ₦${Number(r.amount).toLocaleString("en-NG")}`])} {...f.field("request_id")} /></Field>
      <FormRow>
        <Field label="Bank Reference" {...f.field("bank_reference")}><Input {...f.field("bank_reference")} onChange={(v) => f.set("bank_reference", v.toUpperCase().replace(/\s/g, ""))} placeholder="FT26092812445" /></Field>
        <Field label="Paid On" {...f.field("paid_on")}><DateField {...f.field("paid_on")} max={todayIso()} /></Field>
      </FormRow>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Log Disbursement</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Budgets ───────────── */

function BudgetsTab() {
  const b = useApi("GET /api/v1/expenses/budgets");
  const d = b.data;
  return (
    <>
      <PageHead title="Budgets" sub={d ? `${d.year} · ${d.illustrative ? "no budget lines set" : `${d.lines.length} lines`}` : " "} actions={<Button variant="primary" icon="plus" onClick={() => toast("Budget lines open in 2027, when MyCity starts budgeting operating expense")}>Add Budget Line</Button>} />
      {d?.illustrative && (
        <div className="mb-3 flex items-start gap-2.5 rounded-card bg-info-soft p-[14px] text-info">
          <Icon name="alert" className="mt-0.5 flex-none" />
          <div>
            <h3 className="text-[13.5px] font-semibold">Showing example figures</h3>
            <p className="mt-1 text-[11.5px]">MyCity sets its operating expense budget from 2027. The screen is built and waiting. These numbers are illustrative.</p>
          </div>
        </div>
      )}
      {d ? <BarsCard title="Budget Against Actual, by Department" rows={d.lines.map((l) => ({ label: l.department, pct: l.pct, value: `${formatMoneyShort(l.actual)} of ${formatMoneyShort(l.budget)}`, ...(l.pct >= 90 ? { emphasis: "warn" as const } : {}) }))} /> : <Card><LoadingRows /></Card>}
      <Grid cols={2} className="mt-3">
        <Table
          title="Example Only"
          right={<StatusPill s={{ tone: "info", text: "Illustrative" }} />}
          rows={d?.lines ?? []}
          rowKey={(l) => l.department}
          loading={b.loading}
          columns={[
            { key: "d", label: "Department", render: (l) => l.department },
            { key: "b", label: "Budget", align: "n", render: (l) => <Money value={l.budget} /> },
            { key: "a", label: "Actual", align: "n", render: (l) => <Money value={l.actual} />, desktop: true },
            { key: "v", label: "Variance", align: "n", render: (l) => <Money value={l.variance} />, desktop: true },
            { key: "s", label: "Status", render: (l) => <StatusPill s={l.status} /> },
          ]}
        />
        <KvCard
          title="Built and Handed Over Empty"
          items={[
            ["The ask", "MyCity does not budget operating expense until 2027"],
            ["The decision", "Build it now anyway, hand it over with no lines"],
            ["Why", "Adding budgets later means touching every expense path again"],
            ["The threshold rule", "Fires at 90% of a line. Dormant with no lines"],
            ["Setting one up", "Add a line per department and category, with a period"],
            ["Who sees it", "Finance and the CEO. Managers see their own department"],
          ]}
        />
      </Grid>
    </>
  );
}

/* ───────────── Categories ───────────── */

function Categories() {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/categories/summary");
  const list = usePaged("GET /api/v1/expenses/categories");
  return (
    <>
      <PageHead title="Categories" sub="Expense categories" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Category", body: (close) => <CategoryForm close={close} /> })}>New Category</Button>} />
      {s.data && <KpiTiles items={[{ label: "Categories", value: String(s.data.categories) }, { label: "Spend This Month", value: formatMoneyShort(s.data.spend_this_month) }, { label: "Requests", value: String(s.data.requests) }, { label: "Capital", value: String(s.data.capital) }]} />}
      <PagedTable<Category>
        title="Categories"
        list={list}
        rowKey={(c) => c.category_id}
        noun="category"
        nounPlural="categories"
        columns={[
          { key: "n", label: "Category", render: (c) => <span className="font-semibold">{c.name}</span> },
          { key: "k", label: "Type", render: (c) => c.kind },
          { key: "f", label: "Flag Above", align: "n", render: (c) => <Money value={c.flag_above} />, desktop: true },
          { key: "m", label: "This Month", align: "n", render: (c) => <Money value={c.this_month} /> },
          { key: "r", label: "Requests", align: "n", render: (c) => c.requests },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Spend by Category, This Month" rows={s.data.by_category} /> : <Card><LoadingRows /></Card>}
        <KvCard
          title="What a Flag Does"
          items={[
            ["The chain", "The same for every request: line manager, Operations, requisition, CEO"],
            ["Above the flag", "Marked for the CEO's attention inside the requisition"],
            ["Set per category", "Office at ₦100,000, events at ₦500,000"],
            ["Changing one", "A setting. No deploy, and in-flight requests are unaffected"],
            ["Capital", "Flagged separately for the books. It still follows the same chain"],
          ]}
        />
      </Grid>
    </>
  );
}

function CategoryForm({ close }: { close: () => void }) {
  const f = useForm({ name: "", kind: "Operating", flag_above: "" }, { name: (v) => (!v.trim() ? "Name the category" : null), flag_above: (v) => (!(Number(v) > 0) ? "The amount above which it is flagged" : null) });
  const save = useMutation("POST /api/v1/expenses/categories");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { ...f.values, kind: f.values.kind as Category["kind"] } });
      invalidate("/api/v1/expenses/categories");
      close();
      toast("Category added");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Name" {...f.field("name")}><Input {...f.field("name")} placeholder="e.g. Training" /></Field>
      <FormRow>
        <Field label="Type"><Select options={[["Operating", "Operating"], ["Capital", "Capital"]]} {...f.field("kind")} /></Field>
        <Field label="Flag Above" {...f.field("flag_above")}><AmountInput {...f.field("flag_above")} /></Field>
      </FormRow>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Category</Button>
      </ModalFoot>
    </>
  );
}

