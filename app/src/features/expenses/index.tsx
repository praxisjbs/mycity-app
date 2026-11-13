import budgets from "@mycity/contract/schemas/budgets.js";
import categoriesSchema from "@mycity/contract/schemas/expense_categories.js";
import disbursementsSchema from "@mycity/contract/schemas/disbursements.js";
import requisitionsSchema from "@mycity/contract/schemas/requisitions.js";
import type { Budget, Disbursement, ExpenseCategory, ExpenseRequest, ExpenseRow, Requisition } from "@mycity/contract/contract.gen.ts";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { saveFile } from "@/api/download";
import { PagedTable } from "@/features/shared/sections";
import { paging } from "@/features/shared/wire";
import type { ModuleScreenProps } from "@/shell/screens";
import { useScreenAction } from "@/shell/screen-action";
import {
  ActionGroup, Button, Card, CardHeader, DataView, DateField, EmptyState, ErrorState, Field, formatDate, formatDateTime, formatMoneyShort, FormFooter, Grid, HelpTerm,
  KeyValue, KpiCard, ListDetail, LoadingRows, Money, MoneyField, PageHeader, Pager, Pill, SelectField, TextAreaField, TextField, toast, todayIso, toMoneyString, useConfirm, useContractForm, useModal, UploadField,
} from "@mycity/ui";
import { asTyped, DecisionForm, OwnActions, refreshAll, RequestCard, say, stagePill, useFinance, useRaise } from "./parts";
import { Projects } from "./Projects";

/**
 * Expenses (docs/guides/expenses.md §2, §10): Requisitions, Approvals, Disbursements, Projects,
 * Budgets and Categories. My Requests is an ESS tab (MyRequests.tsx). A request, a requisition and
 * a disbursement open in the modal on desktop and on a phone (F31 as amended for Expenses).
 */
export default function Expenses({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "approvals": return <Approvals id={id} />;
    case "disbursements": return <Disbursements />;
    case "projects": return <Projects />;
    case "budgets": return <BudgetsTab />;
    case "categories": return <Categories />;
    default: return <Requisitions />;
  }
}

type Column = { key: string; label: ReactNode; render: (r: ExpenseRow) => ReactNode; desktop?: boolean; align?: "n" };
const requestColumns = (extra: Column[] = []): Column[] => [
  { key: "n", label: "Reference", render: (r) => <span className="font-semibold">{r.number}</span> },
  { key: "p", label: "Purpose", render: (r) => r.purpose },
  { key: "r", label: "Requester", render: (r) => r.requester.display_name, desktop: true },
  { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
  ...extra,
];
const closed = (title: string, text: string, actions?: ReactNode) => (
  <>
    <PageHeader title={title} actions={actions} />
    <EmptyState title="Not Open to You" text={text} />
  </>
);

/* ───────────── Requisitions ───────────── */

function Requisitions() {
  const finance = useFinance();
  const ready = usePaged("GET /api/v1/expenses", { filters: { status: "approved" }, enabled: finance });
  const list = usePaged("GET /api/v1/requisitions", { sort: "-submitted_at", enabled: finance });
  const [ticked, setTicked] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const create = useMutation("POST /api/v1/requisitions");
  const group = async () => {
    if (!ticked.length) return void toast("Tick a request first");
    try {
      const q = await create.run({ body: { expense_request_ids: ticked } });
      setTicked([]);
      refreshAll();
      toast(`${q.number} sent to the CEO`);
    } catch (e) {
      say(e);
    }
  };
  const raise = useRaise();
  useScreenAction(finance ? { label: "Create Requisition", onSelect: group } : raise ? { label: "New Request", onSelect: raise } : null);
  useScreenAction(finance && raise ? { label: "New Request", onSelect: raise } : null, { second: true });
  const newRequest = raise ? <Button variant={finance ? undefined : "primary"} icon="plus" onClick={async () => raise()}>New Request</Button> : null;
  if (!finance) return closed("Requisitions", "Operations & People group requests.", newRequest);
  return (
    <>
      <PageHeader
        title="Requisitions"
        sub="Approved requests grouped for the CEO"
        actions={
          <ActionGroup>
            {newRequest}
            <Button variant="primary" icon="plus" onClick={group}>Create Requisition</Button>
          </ActionGroup>
        }
      />
      <ListDetail
        layout="modal"
        open={request !== null}
        onClose={() => setRequest(null)}
        title="Expense Request"
        list={
          <>
            <DataView
              title="Approved Requests"
              rows={ready.rows}
              rowKey={(r) => r.expense_request_id}
              loading={ready.loading}
              selection={{ keys: ticked, onChange: setTicked, actions: <Button size="sm" variant="primary" onClick={group}>Create Requisition</Button> }}
              onRowClick={(r) => setRequest(r.expense_request_id)}
              empty={{ title: "Nothing to Group", text: "Approved requests wait here." }}
              columns={requestColumns([{ key: "c", label: "Category", render: (r) => r.category, desktop: true }])}
            />
            <Pager page={ready.page} onPage={ready.setPage} noun="request" label="Approved Requests" />
          </>
        }
        detail={request && <RequestCard id={request} actions={(r) => <OwnActions r={r} close={() => setRequest(null)} />} />}
      />
      <ListDetail
        layout="modal"
        className="mt-3"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Requisition"
        list={
          <PagedTable<Requisition>
            title={<HelpTerm help="Approved requests grouped for the CEO.">Requisitions</HelpTerm>}
            list={list}
            rowKey={(q) => q.requisition_id}
            noun="requisition"
            onRowClick={(q) => setPicked(q.requisition_id)}
            empty={{ title: "No Requisitions Yet", text: "Tick approved requests to group them." }}
            columns={[
              { key: "n", label: "Reference", render: (q) => <span className="font-semibold">{q.number}</span> },
              { key: "c", label: "Requests", align: "n", render: (q) => q.requests },
              { key: "t", label: "Total", align: "n", render: (q) => <Money value={q.total_amount} /> },
              { key: "s", label: "Submitted", render: (q) => (q.submitted_at ? formatDate(q.submitted_at) : "Not sent"), desktop: true },
              { key: "st", label: "Status", render: (q) => <Pill tone={q.status === "approved" ? "ok" : q.status === "submitted" ? "warn" : q.status === "rejected" ? "err" : "neutral"}>{q.status === "submitted" ? "With the CEO" : q.status === "approved" ? "Approved" : q.status === "rejected" ? "Rejected" : "Cancelled"}</Pill> },
            ]}
          />
        }
        detail={picked && <RequisitionCard id={picked} close={() => setPicked(null)} />}
      />
    </>
  );
}

function RequisitionCard({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const d = useApi("GET /api/v1/requisitions/:id", { params: { id } });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  if (!d.data) return <Card>{d.error ? <ErrorState error={d.error} /> : <LoadingRows />}</Card>;
  const q = d.data;
  const done = (text: string) => () => {
    refreshAll();
    close();
    toast(text);
  };
  const remove = (r: ExpenseRow) => modal.open({ title: `Remove ${r.number}`, body: (c) => <RemoveForm requisitionId={id} requestId={r.expense_request_id} close={c} /> });
  const open = (r: ExpenseRow) => modal.open({ title: "Expense Request", wide: true, body: (c) => <RequestCard id={r.expense_request_id} actions={(x) => <OwnActions r={x} close={() => { c(); close(); }} />} /> });
  return (
    <Card>
      <CardHeader record title={q.number} right={<b><Money value={q.total_amount} /></b>} />
      <DataView
        rows={q.items}
        rowKey={(r) => r.expense_request_id}
        onRowClick={open}
        columns={requestColumns(q.can_decide ? [{ key: "x", label: "", render: (r) => (
              // The row opens the request; Remove is its own press, so it stops here.
              <span onClick={(e) => e.stopPropagation()}>
                <Button size="sm" onClick={async () => remove(r)}>Remove</Button>
              </span>
            ) }] : [])}
      />
      {q.can_decide && q.workflow_instance_id && (
        <div className="mt-3">
          <ActionGroup>
            <Button variant="primary" icon="ok" onClick={async () => { try { await approve.run({ params: { id: q.workflow_instance_id! }, body: {} }); done(`${q.number} approved`)(); } catch (e) { say(e); } }}>Approve</Button>
            <Button onClick={async () => modal.open({ title: `Reject ${q.number}`, body: (c) => <DecisionForm instanceId={q.workflow_instance_id!} verb="reject" close={c} onDone={done(`${q.number} rejected`)} /> })}>Reject</Button>
          </ActionGroup>
        </div>
      )}
    </Card>
  );
}

function RemoveForm({ requisitionId, requestId, close }: { requisitionId: string; requestId: string; close: () => void }) {
  const f = useContractForm({ expense_request_id: requestId, reason: "" }, requisitionsSchema.RequisitionRemove);
  const remove = useMutation("POST /api/v1/requisitions/:id/remove");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await remove.run({ params: { id: requisitionId }, body: f.values });
      refreshAll();
      close();
      toast("Removed. It is approved again");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Next month" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Remove Request</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Approvals ───────────── */

function Approvals({ id }: { id: string | null }) {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/approvals/summary");
  const list = usePaged("GET /api/v1/expenses/approvals", { sort: "submitted_at" });
  const [picked, setPicked] = useState<string | null>(id);
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const records = () => modal.open({ title: "With You", wide: true, body: () => <ApprovalRecords /> });
  const approvedByMe = () => modal.open({ title: "Approved This Month", wide: true, body: () => <RequestRecords title="Approved by You" filters={{ approved_by_me_from: `${todayIso().slice(0, 7)}-01` }} /> });
  const raise = useRaise();
  useScreenAction(raise ? { label: "New Request", onSelect: raise } : null);
  return (
    <>
      <PageHeader title="Approvals" sub="Requests waiting on you" actions={raise ? <Button variant="primary" icon="plus" onClick={async () => raise()}>New Request</Button> : undefined} />
      {s.data && (
        <Grid cols="4m2">
          <KpiCard title="With You" value={String(s.data.with_you)} tone={s.data.with_you ? "warn" : "ok"} onOpen={records} />
          <KpiCard title="Total Value" value={formatMoneyShort(s.data.total_value)} onOpen={records} />
          <KpiCard title="Oldest" value={s.data.oldest_days === null ? "None" : `${s.data.oldest_days} days`} />
          <KpiCard title="Approved This Month" value={String(s.data.approved_this_month)} tone="ok" onOpen={approvedByMe} />
        </Grid>
      )}
      <ListDetail
        layout="modal"
        className="mt-3"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Expense Request"
        list={<ApprovalTable list={list} onPick={(r) => setPicked(r.expense_request_id)} />}
        detail={
          picked && (
            <RequestCard
              id={picked}
              actions={(r) => {
                const done = (text: string) => () => {
                  refreshAll();
                  setPicked(null);
                  toast(text);
                };
                if (r.status !== "submitted" || !r.workflow_instance_id) return null;
                const wid = r.workflow_instance_id;
                return (
                  <ActionGroup>
                    <Button variant="primary" icon="ok" onClick={async () => { try { await approve.run({ params: { id: wid }, body: {} }); done(`${r.number} approved`)(); } catch (e) { say(e); } }}>Approve</Button>
                    <Button onClick={async () => modal.open({ title: `Send Back ${r.number}`, body: (c) => <DecisionForm instanceId={wid} verb="request-changes" close={c} onDone={done(`${r.number} sent back`)} /> })}>Send Back</Button>
                    <Button onClick={async () => modal.open({ title: `Reject ${r.number}`, body: (c) => <DecisionForm instanceId={wid} verb="reject" close={c} onDone={done(`${r.number} rejected`)} /> })}>Reject</Button>
                  </ActionGroup>
                );
              }}
            />
          )
        }
      />
    </>
  );
}

/** A KPI card's own requests, 25 a page, in its modal. */
function RequestRecords({ title, filters }: { title: string; filters: Record<string, string> }) {
  return (
    <PagedTable<ExpenseRow>
      title={title}
      list={usePaged("GET /api/v1/expenses", { filters })}
      rowKey={(r) => r.expense_request_id}
      noun="request"
      empty={{ title: "None Yet", text: "Nothing this month." }}
      columns={requestColumns([{ key: "s", label: "Stage", render: (r) => stagePill(r) }])}
    />
  );
}

function ApprovalRecords() {
  return <ApprovalTable list={usePaged("GET /api/v1/expenses/approvals", { sort: "submitted_at" })} />;
}

function ApprovalTable({ list, onPick }: { list: ReturnType<typeof usePaged<"GET /api/v1/expenses/approvals">>; onPick?: (r: ExpenseRow) => void }) {
  return (
    <PagedTable<ExpenseRow>
      title="Waiting on You"
      list={list}
      rowKey={(r) => r.expense_request_id}
      noun="request"
      onRowClick={onPick}
      empty={{ title: "Nothing Waiting on You", text: "Requests reach you as their approver." }}
      columns={requestColumns([
        { key: "b", label: "Budget", render: (r) => (r.over_budget ? <Pill tone="err">Over Budget</Pill> : <Pill tone="ok">Within</Pill>), desktop: true },
        { key: "s", label: "Stage", render: (r) => stagePill(r) },
      ])}
    />
  );
}

/* ───────────── Disbursements ───────────── */

function Disbursements() {
  const modal = useModal();
  const finance = useFinance();
  const waiting = usePaged("GET /api/v1/expenses", { filters: { status: "authorised" }, enabled: finance });
  const missing = usePaged("GET /api/v1/disbursements", { filters: { reference_missing: "true" }, enabled: finance });
  const paid = usePaged("GET /api/v1/disbursements", { sort: "-paid_at", enabled: finance });
  const [picked, setPicked] = useState<Disbursement | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  if (!finance) return closed("Disbursements", "Operations & People record payments.");
  const record = (r: ExpenseRow) => modal.open({ title: `Pay ${r.number}`, body: (c) => <RecordForm request={r} close={c} /> });
  const actions = (r: ExpenseRequest) => (
    <span className="flex flex-wrap gap-2">
      {r.status === "authorised" && <Button variant="primary" onClick={async () => { setRequest(null); record(r); }}>Record Disbursement</Button>}
      <OwnActions r={r} close={() => setRequest(null)} />
    </span>
  );
  return (
    <>
      <PageHeader title="Disbursements" sub="Transfers for authorised requests" />
      <Grid cols="4m2">
        <KpiCard title="Waiting to Pay" value={String(waiting.page?.total ?? 0)} tone={waiting.page?.total ? "warn" : "ok"} onOpen={() => modal.open({ title: "Waiting to Pay", wide: true, body: () => <RequestRecords title="Waiting to Pay" filters={{ status: "authorised" }} /> })} />
        <KpiCard title="Reference Missing" value={String(missing.page?.total ?? 0)} tone={missing.page?.total ? "err" : "ok"} onOpen={() => modal.open({ title: "Reference Missing", wide: true, body: () => <MissingRecords /> })} />
      </Grid>
      <ListDetail
        layout="modal"
        className="mt-3"
        open={request !== null}
        onClose={() => setRequest(null)}
        title="Expense Request"
        list={
          <PagedTable<ExpenseRow>
            title="Waiting to Pay"
            list={waiting}
            rowKey={(r) => r.expense_request_id}
            noun="request"
            onRowClick={(r) => setRequest(r.expense_request_id)}
            empty={{ title: "Nothing to Pay", text: "Authorised requests wait here." }}
            columns={requestColumns()}
          />
        }
        detail={request && <RequestCard id={request} actions={actions} />}
      />
      <ListDetail
        layout="modal"
        className="mt-3"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Disbursement"
        list={<PaidTable list={paid} onPick={setPicked} />}
        detail={picked && <PaidCard d={picked} close={() => setPicked(null)} />}
      />
    </>
  );
}

function MissingRecords() {
  return <PaidTable list={usePaged("GET /api/v1/disbursements", { filters: { reference_missing: "true" } })} />;
}

function PaidTable({ list, onPick }: { list: ReturnType<typeof usePaged<"GET /api/v1/disbursements">>; onPick?: (d: Disbursement) => void }) {
  return (
    <PagedTable<Disbursement>
      title="Paid"
      list={list}
      search="Search references"
      rowKey={(d) => d.disbursement_id}
      noun="disbursement"
      onRowClick={onPick}
      empty={{ title: "Nothing Paid Yet", text: "Recorded transfers show here." }}
      columns={[
        { key: "n", label: "Reference", render: (d) => <span className="font-semibold">{d.number}</span> },
        { key: "p", label: "Payee", render: (d) => d.recipient_name },
        { key: "a", label: "Amount", align: "n", render: (d) => <Money value={d.amount} /> },
        { key: "d", label: "Paid On", render: (d) => (d.paid_on ? formatDate(d.paid_on) : "Not set"), desktop: true },
        { key: "r", label: <HelpTerm help="The bank's transaction ID for this transfer.">Bank Reference</HelpTerm>, render: (d) => (d.reference_missing ? <Pill tone="err">Reference Missing</Pill> : <span className="font-mono text-xs">{d.payment_reference}</span>) },
      ]}
    />
  );
}

function PaidCard({ d, close }: { d: Disbursement; close: () => void }) {
  const modal = useModal();
  return (
    <Card>
      <CardHeader record title={`${d.number}, ${d.request_number}`} right={d.reference_missing ? <Pill tone="err">Reference Missing</Pill> : <Pill tone="ok">Paid</Pill>} />
      <KeyValue
        items={[
          ["Purpose", d.purpose],
          ["Payee", [d.recipient_name, d.bank_name, d.account_number].filter(Boolean).join(", ")],
          ["Amount", <Money key="a" value={d.amount} />],
          ["Bank Reference", d.payment_reference ?? "Missing"],
          ["Paid On", d.paid_on ? formatDate(d.paid_on) : "Not set"],
          ["Recorded By", d.processed_by ?? "Unknown"],
          ["Receipt", d.receipt ? <Button key="rc" size="sm" icon="doc" onClick={() => saveFile(`/api/v1/documents/${d.receipt!.document_id}/content`, d.receipt!.file_name)}>Open Receipt</Button> : "None"],
        ]}
      />
      {d.reference_missing && (
        <div className="mt-3">
          <Button variant="primary" onClick={async () => { close(); modal.open({ title: "Add Reference", body: (c) => <ReferenceForm id={d.disbursement_id} close={c} /> }); }}>Add Reference</Button>
        </div>
      )}
    </Card>
  );
}

function RecordForm({ request, close }: { request: ExpenseRow; close: () => void }) {
  const confirm = useConfirm();
  const [receipt, setReceipt] = useState("");
  const f = useContractForm({ expense_request_id: request.expense_request_id, payment_reference: "", receipt_document_id: "", paid_on: todayIso(), confirm_without_reference: false }, disbursementsSchema.DisbursementCreate);
  const save = useMutation("POST /api/v1/disbursements");
  const submit = async () => {
    if (!f.check()) return;
    const body = { ...f.values, receipt_document_id: receipt };
    try {
      if (!body.payment_reference && !receipt) {
        const yes = await confirm({ title: "Save Without Reference?", body: "It shows as Reference Missing until added.", confirmLabel: "Save Anyway", cancelLabel: "Add Reference" });
        if (!yes) {
          // No puts the person on the field they were asked to fill (audit F12), once the dialog
          // has handed focus back.
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="payment_reference"]')?.focus());
          return;
        }
        body.confirm_without_reference = true;
      }
      const d = await save.run({ body });
      refreshAll();
      close();
      toast(`${d.number} recorded`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label={<HelpTerm help="The bank's transaction ID for this transfer.">Bank Reference</HelpTerm>} optional {...f.status("payment_reference")}>
        <TextField {...f.field("payment_reference")} onChange={(v) => f.set("payment_reference", v.toUpperCase().replace(/\s/g, ""))} placeholder="GT2611050042" />
      </Field>
      <Field label="Receipt" optional>
        <UploadField upload={upload} purpose="document" accept=".pdf,image/*" multiple={false} compact onUploaded={(docs) => setReceipt(docs[0]?.document_id ?? "")} />
      </Field>
      <Field label="Paid On" {...f.status("paid_on")}><DateField {...f.field("paid_on")} max={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Record Disbursement</Button>
      </FormFooter>
    </>
  );
}

function ReferenceForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ payment_reference: "", receipt_document_id: "" }, disbursementsSchema.DisbursementReference);
  const save = useMutation("PATCH /api/v1/disbursements/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      refreshAll();
      close();
      toast("Reference added");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Bank Reference" {...f.status("payment_reference")}><TextField {...f.field("payment_reference")} placeholder="GT2611050042" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add Reference</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Budgets ───────────── */

const thisYear = () => Number(todayIso().slice(0, 4));
const YEARS = [thisYear() - 1, thisYear(), thisYear() + 1].map((x) => [String(x), String(x)] as [string, string]);

function BudgetsTab() {
  const modal = useModal();
  const finance = useFinance();
  const [year, setYear] = useState(String(thisYear()));
  const list = usePaged("GET /api/v1/budgets", { filters: { year: Number(year) }, sort: "name" });
  const [picked, setPicked] = useState<string | null>(null);
  const add = () => modal.open({ title: "New Budget", wide: true, body: (c) => <BudgetForm close={c} year={year} /> });
  useScreenAction(finance ? { label: "New Budget", onSelect: add } : null);
  return (
    <>
      <PageHeader title="Budgets" sub="Each department's year by category" actions={finance ? <Button variant="primary" icon="plus" onClick={async () => add()}>New Budget</Button> : undefined} />
      <Field label="Year"><SelectField options={YEARS} value={year} onChange={setYear} /></Field>
      <ListDetail
        layout="modal"
        size="wide"
        className="mt-3"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Budget"
        list={
          <PagedTable<Budget>
            title="Departments"
            list={list}
            rowKey={(b) => b.budget_id}
            noun="budget"
            onRowClick={(b) => setPicked(b.budget_id)}
            empty={{ title: "No Budget for the Year", text: finance ? "Set one with New Budget." : "Operations & People set budgets." }}
            columns={[
              { key: "d", label: "Department", render: (b) => <span className="font-semibold">{b.department ?? b.name}</span> },
              { key: "a", label: "Allocated", align: "n", render: (b) => <Money value={b.allocated} /> },
              { key: "c", label: <HelpTerm help="Approved but not yet paid.">Committed</HelpTerm>, align: "n", render: (b) => <Money value={b.committed} />, desktop: true },
              { key: "s", label: "Spent", align: "n", render: (b) => <Money value={b.spent} />, desktop: true },
              { key: "r", label: <HelpTerm help="Allocated less committed and spent.">Remaining</HelpTerm>, align: "n", render: (b) => <Money value={b.remaining} /> },
            ]}
          />
        }
        detail={picked && <BudgetCard id={picked} close={() => setPicked(null)} />}
      />
    </>
  );
}

function BudgetCard({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const finance = useFinance();
  const d = useApi("GET /api/v1/budgets/:id", { params: { id } });
  if (!d.data) return <Card>{d.error ? <ErrorState error={d.error} /> : <LoadingRows />}</Card>;
  const b = d.data;
  return (
    <Card>
      <CardHeader record title={b.name} right={<Money value={b.remaining} />} />
      <DataView
        rows={b.lines}
        rowKey={(l) => l.budget_line_id}
        columns={[
          { key: "c", label: "Category", render: (l) => l.category },
          { key: "a", label: "Allocated", align: "n", render: (l) => <Money value={l.amount} /> },
          { key: "m", label: "Committed", align: "n", render: (l) => <Money value={l.committed_amount} />, desktop: true },
          { key: "s", label: "Spent", align: "n", render: (l) => <Money value={l.spent_amount} />, desktop: true },
          { key: "r", label: "Remaining", align: "n", render: (l) => <Money value={l.remaining} /> },
        ]}
      />
      <div className="mt-3">
        <ActionGroup>
          {finance && <Button variant="primary" onClick={async () => { close(); modal.open({ title: "Edit Budget", wide: true, body: (c) => <BudgetForm close={c} budget={b} /> }); }}>Edit Budget</Button>}
          <Button onClick={async () => modal.open({ title: "Budget History", wide: true, body: () => <BudgetHistory id={id} /> })}>Budget History</Button>
        </ActionGroup>
      </div>
    </Card>
  );
}

function BudgetHistory({ id }: { id: string }) {
  const list = usePaged("GET /api/v1/budgets/:id/history", { params: { id } });
  return (
    <PagedTable
      list={list}
      rowKey={(c) => `${c.at}:${c.category}`}
      noun="change"
      columns={[
        { key: "t", label: "When", render: (c) => formatDateTime(c.at) },
        { key: "c", label: "Category", render: (c) => c.category ?? "Removed" },
        { key: "b", label: "Before", align: "n", render: (c) => (c.before === null ? "None" : <Money value={c.before} />) },
        { key: "a", label: "After", align: "n", render: (c) => (c.after === null ? "Removed" : <Money value={c.after} />) },
        { key: "w", label: "By", render: (c) => c.by ?? "System", desktop: true },
      ]}
    />
  );
}

type BudgetLineValue = { expense_category_id: string; amount: string };
function BudgetForm({ close, year, budget }: { close: () => void; year?: string; budget?: Budget }) {
  const cats = useInfinite("GET /api/v1/expense-categories", { filters: { active: "true" }, sort: "name" });
  const depts = useInfinite("GET /api/v1/departments", { filters: { active: "true" } });
  const start = {
    department_id: budget?.department_id ?? "",
    year: Number(budget ? budget.starts_on.slice(0, 4) : year),
    lines: (budget?.lines.map((l) => ({ expense_category_id: l.expense_category_id, amount: asTyped(l.amount) })) ?? [{ expense_category_id: "", amount: "" }]) as BudgetLineValue[],
  };
  // An amount as typed ("20,000,000") is read and sent as the contract's two-place string.
  const onWire = (ls: BudgetLineValue[]) => ls.map((l) => ({ ...l, amount: toMoneyString(l.amount) }));
  const f = useContractForm(start, { safeParse: (v: Record<string, unknown>) => (budget ? budgets.BudgetUpdate : budgets.BudgetCreate).safeParse({ ...v, lines: onWire(v.lines as BudgetLineValue[]) }) });
  const create = useMutation("POST /api/v1/budgets");
  const edit = useMutation("PATCH /api/v1/budgets/:id");
  const lines = f.values.lines as BudgetLineValue[];
  const setLines = (next: BudgetLineValue[]) => f.set("lines", next);
  const submit = async () => {
    if (!f.check(budget ? ["lines"] : undefined)) return;
    try {
      if (budget) await edit.run({ params: { id: budget.budget_id }, body: { lines: onWire(lines) } });
      else await create.run({ body: { department_id: f.values.department_id, year: f.values.year, lines: onWire(lines) } });
      refreshAll();
      close();
      toast(budget ? "Budget saved" : "Budget set");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const options = cats.rows.map((c) => [c.expense_category_id, c.name] as [string, string]);
  return (
    <>
      {!budget && (
        <Grid cols={2}>
          <Field label="Department" {...f.status("department_id")}><SelectField placeholder="Pick One" options={depts.rows.map((d) => [d.department_id, d.name] as [string, string])} {...paging(depts)} {...f.field("department_id")} /></Field>
          <Field label="Year" {...f.status("year")}><SelectField options={YEARS} value={String(f.values.year)} onChange={(v) => f.set("year", Number(v))} /></Field>
        </Grid>
      )}
      <Field label="Lines" {...f.status("lines")}>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-5 items-end gap-2 max-md:grid-cols-2">
              <span className="col-span-3 max-md:col-span-2">
                <Field label={`Category ${i + 1}`}>
                  <SelectField name={`line-${i}-category`} placeholder="Pick One" options={options} {...paging(cats)} value={l.expense_category_id} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, expense_category_id: v } : x)))} />
                </Field>
              </span>
              <Field label="Amount">
                <MoneyField name={`line-${i}-amount`} value={l.amount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </Field>
              <span className="flex min-h-tap items-center">{lines.length > 1 && <Button size="sm" onClick={async () => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>}</span>
            </div>
          ))}
          {lines.length < 25 && <Button size="sm" icon="plus" onClick={async () => setLines([...lines, { expense_category_id: "", amount: "" }])}>Add Category</Button>}
        </div>
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{budget ? "Save Budget" : "Set Budget"}</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Categories ───────────── */

function Categories() {
  const modal = useModal();
  const finance = useFinance();
  const list = usePaged("GET /api/v1/expense-categories", { sort: "name" });
  const suggested = useMutation("POST /api/v1/expense-categories/suggested");
  const add = () => modal.open({ title: "New Category", body: (c) => <CategoryForm close={c} /> });
  useScreenAction(finance ? { label: "New Expense Category", onSelect: add } : null);
  const empty = !list.loading && list.page?.total === 0 && !list.q;
  return (
    <>
      <PageHeader title="Categories" sub="What expense money is for" actions={finance ? <Button variant="primary" icon="plus" onClick={async () => add()}>New Category</Button> : undefined} />
      {empty && finance ? (
        <Card>
          <EmptyState title="No Categories Yet" text="Start from the suggested twelve." />
          <div className="mt-3 flex justify-center">
            <Button variant="primary" icon="spark" onClick={async () => { try { await suggested.run({ body: {} }); refreshAll(); toast("Twelve categories added"); } catch (e) { say(e); } }}>Add Suggested Categories</Button>
          </div>
        </Card>
      ) : (
        <PagedTable<ExpenseCategory>
          title="Categories"
          list={list}
          search="Search categories"
          rowKey={(c) => c.expense_category_id}
          noun="category"
          nounPlural="categories"
          onRowClick={finance ? (c) => modal.open({ title: "Edit Category", body: (close) => <CategoryForm close={close} category={c} /> }) : undefined}
          columns={[
            { key: "n", label: "Category", render: (c) => <span className="font-semibold">{c.name}</span> },
            { key: "t", label: <HelpTerm help="Capital is equipment kept for years.">Type</HelpTerm>, render: (c) => (c.type === "capital" ? "Capital" : "Operating") },
            { key: "m", label: "This Month", align: "n", render: (c) => <Money value={c.spent_this_month} /> },
            { key: "r", label: "Requests", align: "n", render: (c) => c.requests, desktop: true },
            { key: "a", label: "Offered", render: (c) => (c.active ? <Pill tone="ok">Offered</Pill> : <Pill tone="neutral">Off</Pill>), desktop: true },
          ]}
        />
      )}
    </>
  );
}

function CategoryForm({ close, category }: { close: () => void; category?: ExpenseCategory }) {
  const f = useContractForm(
    { name: category?.name ?? "", type: category?.type ?? ("operating" as ExpenseCategory["type"]), description: category?.description ?? "" },
    category ? categoriesSchema.ExpenseCategoryUpdate : categoriesSchema.ExpenseCategoryCreate,
  );
  const create = useMutation("POST /api/v1/expense-categories");
  const edit = useMutation("PATCH /api/v1/expense-categories/:id");
  const confirm = useConfirm();
  const submit = (active?: boolean) => async () => {
    if (active === undefined && !f.check()) return;
    if (active === false && category && !(await confirm({ title: "Deactivate Category", body: `New requests can no longer pick ${category.name}.`, confirmLabel: "Deactivate", cancelLabel: "Keep Category", destructive: true }))) return;
    try {
      if (category) await edit.run({ params: { id: category.expense_category_id }, body: active === undefined ? f.values : { active } });
      else await create.run({ body: f.values });
      refreshAll();
      close();
      toast(active === false ? "Category deactivated" : active ? "Category offered again" : category ? "Category saved" : "Category added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}><TextField {...f.field("name")} placeholder="Field Logistics" /></Field>
      <Field label="Type"><SelectField options={[["operating", "Operating"], ["capital", "Capital"]]} value={f.values.type} onChange={(v) => f.set("type", v as ExpenseCategory["type"])} /></Field>
      <Field label="Description" optional><TextAreaField {...f.field("description")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {category && <Button onClick={submit(!category.active)}>{category.active ? "Deactivate" : "Offer Again"}</Button>}
        <Button variant="primary" onClick={submit()}>{category ? "Save Category" : "Add Category"}</Button>
      </FormFooter>
    </>
  );
}
