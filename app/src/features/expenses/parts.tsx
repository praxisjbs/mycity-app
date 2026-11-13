import expenses from "@mycity/contract/schemas/expenses.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { ExpenseBank, ExpenseCategory, ExpenseRequest, ExpenseRow } from "@mycity/contract/contract.gen.ts";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { saveFile } from "@/api/download";
import { useMe } from "@/auth/AuthProvider";
import { hasCapability } from "@/shell/access";
import { paging } from "@/features/shared/wire";
import type { Tone } from "@/api/types/common";
import {
  ActionGroup, Button, Card, CardHeader, Chain, CheckboxField, ChoiceField, ComboField, DataView, Details, ErrorState, Field, formatDate, formatDateTime, formatMoney, FormFooter, Grid, HelpTerm, IconButton, KeyValue,
  LoadingRows, Money, MoneyField, Pager, Pill, plural, Popover, RecordPicker, SelectField, Sub, TextAreaField, TextField, Timeline, toast, toMoneyString, useConfirm, useContractForm, useModal, UploadField, type ComboFieldProps,
} from "@mycity/ui";

/*
 * What the Expenses screens share (docs/guides/expenses.md §10): a request's status pill, New
 * Request's form with its lines, a request's modal, and the reason a decision asks for.
 */

export const useFinance = () => hasCapability(useMe(), "expenses.finance");

/**
 * New Request from the Expenses tabs that offer it (Requisitions and Approvals): the same form and
 * service as ESS · My Requests, the request the person's own. Null without `expenses` create.
 */
export function useRaise(): (() => void) | null {
  const modal = useModal();
  const may = Boolean(useMe().grants.expenses?.includes("create"));
  return may ? () => modal.open({ title: "New Request", wide: true, body: (close) => <RequestForm close={close} /> }) : null;
}

export const say = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Not saved. Try again.");
export const refreshAll = () => {
  invalidate("/api/v1/expenses");
  invalidate("/api/v1/requisitions");
  invalidate("/api/v1/disbursements");
  invalidate("/api/v1/budgets");
  invalidate("/api/v1/expense-categories");
  invalidate("/api/v1/workflow");
};

const STATUS: Record<ExpenseRow["status"], { tone: Tone; text: string }> = {
  draft: { tone: "neutral", text: "Draft" },
  submitted: { tone: "warn", text: "Waiting" },
  sent_back: { tone: "warn", text: "Sent Back" },
  approved: { tone: "info", text: "Approved" },
  in_requisition: { tone: "info", text: "With the CEO" },
  authorised: { tone: "info", text: "Authorised" },
  disbursed: { tone: "ok", text: "Paid" },
  rejected: { tone: "err", text: "Rejected" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};
/** A request's stage as the list's pill reads it: who it waits on, or where it ended. */
export const stagePill = (r: Pick<ExpenseRow, "status" | "waiting_on">) => (
  <Pill tone={STATUS[r.status].tone}>{r.status === "submitted" && r.waiting_on ? r.waiting_on : STATUS[r.status].text}</Pill>
);

export const PAYEES: Array<[ExpenseRow["payee_type"], string]> = [
  ["staff", "Staff"],
  ["vendor", "Vendor"],
  ["partner", "Partner"],
  ["task_team", "Dedicated Task Team (DTT)"],
];

/*
 * Category: a button that opens a popover with a type filter and a search over the server's
 * categories, 25 a page (TB, 11/11/2026: thirty or forty categories are searched, never scrolled).
 */
const CATEGORY_TYPES: Array<["" | ExpenseCategory["type"], string]> = [["", "All"], ["operating", "Operating"], ["capital", "Capital"]];

function CategoryField({ value, label, onPick }: { value: string; label?: string | null; onPick: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"" | ExpenseCategory["type"]>("");
  const list = usePaged("GET /api/v1/expense-categories", { filters: { active: "true", ...(type ? { type } : {}) }, sort: "name", enabled: open });
  return (
    <Popover
      title="Pick Category"
      open={open}
      onOpenChange={setOpen}
      className="w-80"
      trigger={<Button iconRight="down" className="w-full justify-between">{value ? (label ?? "Category Picked") : "Pick Category"}</Button>}
    >
      <div className="flex flex-col gap-3">
        <ChoiceField label="Category Type" value={type} onChange={setType} options={CATEGORY_TYPES} />
        <RecordPicker<ExpenseCategory>
          list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
          value={[]}
          onChange={(rows) => {
            const c = rows[0];
            if (!c) return;
            onPick(c.expense_category_id, c.name);
            setOpen(false);
          }}
          id={(c) => c.expense_category_id}
          title={(c) => c.name}
          sub={(c) => (c.type === "capital" ? "Capital" : "Operating")}
          placeholder="Search categories"
        />
      </div>
    </Popover>
  );
}

/*
 * Bank: typed or picked. The server suggests the common banks and every bank a request has named;
 * a bank it does not know is added as typed (Add, with a plus) and offered from then on (TB, 11/11/2026).
 */
function BankField(binding: Omit<ComboFieldProps<ExpenseBank>, "list" | "option" | "sub" | "placeholder">) {
  const banks = usePaged("GET /api/v1/expenses/banks");
  return <ComboField<ExpenseBank> {...binding} list={banks} option={(b) => b.bank_name} sub={(b) => (b.uses ? plural(b.uses, "request") : undefined)} placeholder="Zenith Bank" />;
}

/* Money in kobo for a total on the form, never in floating point; a line that takes money off is below zero. */
const kobo = (v: string) => {
  const wire = toMoneyString(String(v || "")) || "0";
  const minus = wire.startsWith("-");
  const [w, f = ""] = (minus ? wire.slice(1) : wire).split(".");
  const k = Number(w || "0") * 100 + Number((f + "00").slice(0, 2));
  return minus ? -k : k;
};
const naira = (k: number) => `${k < 0 ? "-" : ""}${Math.trunc(Math.abs(k) / 100)}.${String(Math.abs(k) % 100).padStart(2, "0")}`;

/* ------------------------------------------------------------------ *
 * New Request and Edit
 * ------------------------------------------------------------------ */

type LineValue = { description: string; quantity: string; unit_price: string };
/** The lines as the contract takes them: a unit price as typed ("4,500") sent as a two-place string ("4500.00"). */
const linesOnWire = (lines: LineValue[]) => lines.map((l) => ({ ...l, unit_price: toMoneyString(l.unit_price) }));
const EMPTY_LINE: LineValue = { description: "", quantity: "1", unit_price: "" };

/**
 * New Request, and Edit of a draft or sent-back request (`existing`): Purpose, Category, Project,
 * Department, the lines, the payee, the invoice; Save Draft and Send Request in the footer.
 * Read Invoice and Suggest Category fill it for the person to check; nothing is saved until they press.
 */
export function RequestForm({ close, existing, project }: { close: () => void; existing?: ExpenseRequest; project?: string }) {
  const projects = useInfinite("GET /api/v1/projects", { filters: { status: "active" } });
  const depts = useInfinite("GET /api/v1/departments", { filters: { active: "true" } });
  const [invoice, setInvoice] = useState(existing?.invoice ?? null);
  const [category, setCategory] = useState<string | null>(existing?.category ?? null);
  const f = useContractForm(
    {
      purpose: existing?.purpose ?? "",
      expense_category_id: existing?.expense_category_id ?? "",
      project_id: existing?.project_id ?? project ?? "",
      department_id: existing?.department_id ?? "",
      needed_on: "",
      lines: existing ? existing.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price })) : [{ ...EMPTY_LINE }],
      payee_type: existing?.payee_type ?? ("vendor" as ExpenseRow["payee_type"]),
      uses_profile_account: existing?.uses_profile_account ?? false,
      payee_name: existing?.uses_profile_account ? "" : (existing?.payee_name ?? ""),
      bank_name: existing?.uses_profile_account ? "" : (existing?.bank_name ?? ""),
      account_name: existing?.uses_profile_account ? "" : (existing?.account_name ?? ""),
      account_number: existing?.uses_profile_account ? "" : (existing?.account_number ?? ""),
      invoice_document_id: existing?.invoice?.document_id ?? "",
    },
    // The schema reads the lines as they will be sent, so "4500" is an amount, not a wrong format.
    { safeParse: (v: Record<string, unknown>) => expenses.ExpenseFields.safeParse({ ...v, lines: linesOnWire(v.lines as LineValue[]) }) },
  );
  const create = useMutation("POST /api/v1/expenses/mine");
  const edit = useMutation("PATCH /api/v1/expenses/mine/:id");
  const submitOne = useMutation("POST /api/v1/expenses/mine/:id/submit");
  const read = useMutation("POST /api/v1/expenses/mine/invoice-reading");
  const suggest = useMutation("POST /api/v1/expenses/mine/category-suggestion");
  const lines = f.values.lines as LineValue[];
  const setLines = (next: LineValue[]) => f.set("lines", next);
  const total = naira(lines.reduce((a, l) => a + Math.round(Number(l.quantity || "0") * kobo(l.unit_price)), 0));
  const profile = f.values.payee_type === "staff" && f.values.uses_profile_account;

  const save = (send: boolean) => async () => {
    if (!f.check()) return;
    const body = { ...f.values, lines: linesOnWire(lines), invoice_document_id: invoice?.document_id ?? "" };
    try {
      let saved: ExpenseRequest;
      if (existing) {
        saved = await edit.run({ params: { id: existing.expense_request_id }, body });
        if (send) saved = await submitOne.run({ params: { id: existing.expense_request_id }, body: {} });
      } else saved = await create.run({ body: { ...body, submit: send } });
      refreshAll();
      close();
      toast(send ? `${saved.number} sent` : `${saved.number} saved`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const readInvoice = async () => {
    if (!invoice) return;
    try {
      const got = await read.run({ body: { document_id: invoice.document_id } });
      if (!got.available) return toast(got.reason === "limit" ? "AI limit reached this month" : got.reason === "unreadable" ? "This file cannot be read" : "AI is off");
      if (got.payee_name) f.set("payee_name", got.payee_name);
      if (got.expense_category_id) {
        f.set("expense_category_id", got.expense_category_id);
        setCategory(null);
      }
      if (got.lines.length) setLines(got.lines.map((l) => ({ description: l.description, quantity: l.quantity ?? "1", unit_price: l.unit_price })));
      // The lines are the model's reading; the amount the invoice asks for is read on its own, so a
      // discount or a payment it missed shows here rather than at the bank.
      if (got.amount_due && got.amount && kobo(got.amount_due) !== kobo(got.amount)) return toast(`Invoice asks ${formatMoney(got.amount_due)}. Check lines`);
      toast("Invoice read. Check every line");
    } catch (e) {
      say(e);
    }
  };
  const suggestCategory = async () => {
    if (!f.values.purpose.trim()) return toast("Write the purpose first");
    try {
      const got = await suggest.run({ body: { purpose: f.values.purpose, lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description })) } });
      if (!got.available) return toast(got.reason === "limit" ? "AI limit reached this month" : "AI is off");
      if (!got.expense_category_id) return toast("No category fits");
      f.set("expense_category_id", got.expense_category_id);
      setCategory(got.category);
      toast(`${got.category} picked`);
    } catch (e) {
      say(e);
    }
  };

  return (
    <>
      <Field label="Purpose" {...f.status("purpose")}>
        <TextField {...f.field("purpose")} placeholder="Ikeja activation" />
      </Field>
      <Grid cols={2}>
        <Field label="Category" {...f.status("expense_category_id")}>
          <CategoryField value={f.values.expense_category_id} label={category} onPick={(id, name) => { f.set("expense_category_id", id); setCategory(name); }} />
        </Field>
        <Field label="Project" optional>
          <SelectField placeholder="None" options={[["", "None"], ...projects.rows.map((p) => [p.project_id, p.name] as [string, string])]} {...paging(projects)} {...f.field("project_id")} />
        </Field>
      </Grid>
      <Field label="Department" optional>
        <SelectField placeholder="My Department" options={[["", "My Department"], ...depts.rows.map((d) => [d.department_id, d.name] as [string, string])]} {...paging(depts)} {...f.field("department_id")} />
      </Field>
      <Field label="Lines" {...f.status("lines")}>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-6 items-end gap-2 max-md:grid-cols-2">
              <span className="col-span-3 max-md:col-span-2">
                <Field label={`Item ${i + 1}`}>
                  <TextField name={`line-${i}-description`} value={l.description} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, description: v } : x)))} placeholder="Crates of water" />
                </Field>
              </span>
              <Field label="Quantity">
                <TextField name={`line-${i}-quantity`} inputMode="decimal" value={l.quantity} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: v.replace(/[^\d.]/g, "") } : x)))} />
              </Field>
              <Field label="Unit Price">
                <MoneyField signed name={`line-${i}-unit_price`} value={l.unit_price} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: v } : x)))} />
              </Field>
              {lines.length > 1 && (
                <span className="flex min-h-tap items-center">
                  <IconButton icon="trash" label={`Remove Item ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                </span>
              )}
            </div>
          ))}
          <span className="flex flex-wrap items-center justify-between gap-2">
            {lines.length < 25 && <Button size="sm" icon="plus" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>Add Line</Button>}
            <b className="text-sm">Total <Money value={total} /></b>
          </span>
        </div>
      </Field>
      <Field label="Payee" {...f.status("payee_type")}>
        <SelectField options={PAYEES} value={f.values.payee_type} onChange={(v) => { f.set("payee_type", v as ExpenseRow["payee_type"]); if (v !== "staff") f.set("uses_profile_account", false); }} />
      </Field>
      {f.values.payee_type === "staff" && (
        <Field label={<HelpTerm help="Pays the bank account on your profile.">Company Account</HelpTerm>}>
          <CheckboxField label="Use My Company Account" {...f.field("uses_profile_account")} />
        </Field>
      )}
      {!profile && (
        <Grid cols={2}>
          <Field label="Payee Name" {...f.status("payee_name")}><TextField {...f.field("payee_name")} placeholder="Amaka Okafor" /></Field>
          <Field label="Bank" {...f.status("bank_name")}><BankField {...f.field("bank_name")} /></Field>
          <Field label="Account Name" {...f.status("account_name")}><TextField {...f.field("account_name")} placeholder="Amaka Okafor" /></Field>
          <Field label="Account Number" {...f.status("account_number")}>
            <TextField {...f.field("account_number")} inputMode="numeric" onChange={(v) => f.set("account_number", v.replace(/\D/g, "").slice(0, 10))} placeholder="0123456789" />
          </Field>
        </Grid>
      )}
      <Field label="Invoice" optional>
        {invoice ? (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <Sub>{invoice.file_name}</Sub>
            <ActionGroup>
              <Button size="sm" icon="spark" onClick={readInvoice}>Read Invoice</Button>
              <Button size="sm" onClick={async () => setInvoice(null)}>Replace</Button>
            </ActionGroup>
          </span>
        ) : (
          <UploadField upload={upload} purpose="document" accept=".pdf,image/*" multiple={false} compact onUploaded={(d) => setInvoice(d[0])} />
        )}
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button icon="spark" onClick={suggestCategory}>Suggest Category</Button>
        <Button onClick={save(false)}>Save Draft</Button>
        <Button variant="primary" onClick={save(true)}>{existing?.status === "sent_back" ? "Send Again" : "Send Request"}</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * A request's modal
 * ------------------------------------------------------------------ */

function RouteCard({ instanceId }: { instanceId: string }) {
  const d = useApi("GET /api/v1/workflow/instances/:id", { params: { id: instanceId } });
  if (!d.data) return d.error ? null : <LoadingRows />;
  return <Chain steps={d.data.route.map((s) => ({ label: s.name, state: s.state === "done" ? "done" : s.state === "now" ? "now" : undefined }))} />;
}

function History({ id }: { id: string }) {
  const h = usePaged("GET /api/v1/expenses/:id/history", { params: { id } });
  if (h.loading && !h.rows.length) return <LoadingRows />;
  return (
    <>
      <Timeline items={h.rows.map((e) => ({ title: e.label, when: formatDateTime(e.at), text: [e.by, e.reason].filter(Boolean).join(". ") || undefined }))} />
      <Pager page={h.page} onPage={h.setPage} noun="step" />
    </>
  );
}

/** A request as its modal shows it: lines, total, payee, invoice, budget, the route and its history; `actions` below. */
/** The model's explanation cut to one sentence of at most 20 words (screen text tiers). */
function clampWords(text: string | null | undefined): string | null {
  if (!text) return null;
  const first = text.trim().split(/(?<=[.!?])\s/)[0];
  const words = first.split(/\s+/);
  return words.length > 20 ? `${words.slice(0, 20).join(" ").replace(/[,;:]$/, "")}.` : first;
}

export function RequestCard({ id, actions }: { id: string; actions?: (r: ExpenseRequest) => ReactNode }) {
  const d = useApi("GET /api/v1/expenses/:id", { params: { id } });
  const dup = useMutation("POST /api/v1/expenses/:id/duplicate-check");
  const [verdict, setVerdict] = useState<{ line: string; why: string | null } | null>(null);
  if (!d.data) return <Card>{d.error ? <ErrorState error={d.error} /> : <LoadingRows />}</Card>;
  const r = d.data;
  const check = async () => {
    try {
      const got = await dup.run({ params: { id }, body: {} });
      setVerdict(
        got.available
          ? { line: got.duplicate ? `Likely repeats ${got.duplicate.number}` : "Looks different", why: clampWords(got.explanation) }
          : { line: got.reason === "none" ? "Nothing to compare" : "AI is off", why: null },
      );
    } catch (e) {
      say(e);
    }
  };
  return (
    <Card>
      <CardHeader record title={`${r.number}, ${r.purpose}`} right={stagePill(r)} />
      <span className="mb-2 flex flex-wrap gap-2">
        {r.over_budget && <HelpTerm help="More than the department has left for this category this year."><Pill tone="err">Over Budget</Pill></HelpTerm>}
        {r.possible_duplicates.length + r.possible_duplicates_hidden > 0 && <HelpTerm help="Same payee and amount within 30 days."><Pill tone="warn">Possible Duplicate</Pill></HelpTerm>}
      </span>
      <DataView
        rows={r.lines}
        rowKey={(l) => l.expense_request_line_id}
        columns={[
          { key: "d", label: "Item", render: (l) => l.description },
          { key: "q", label: "Quantity", align: "n", render: (l) => l.quantity },
          // A line that takes money off (a discount, an amount paid) reads "less", short enough for the modal.
          { key: "u", label: "Unit Price", align: "n", render: (l) => <Money value={l.unit_price} negLabel="less" />, desktop: true },
          { key: "a", label: "Amount", align: "n", render: (l) => <Money value={l.amount} negLabel="less" /> },
        ]}
      />
      <div className="mt-3">
        <KeyValue
          items={[
            ["Total", <Money key="t" value={r.amount} />],
            ["Requested By", r.requester.display_name],
            ["Category", r.category],
            ["Project", r.project ?? "None"],
            ["Department", r.department ?? "None"],
            ["Payee", [PAYEES.find(([k]) => k === r.payee_type)?.[1], r.payee_name, r.bank_name, r.account_number].filter(Boolean).join(", ")],
            ["Budget Left", r.budget_remaining === null ? "No budget line" : <Money key="b" value={r.budget_remaining} />],
            ["Department Left", r.department_remaining === null ? "No budget" : <Money key="d" value={r.department_remaining} />],
            ["Submitted", r.submitted_at ? formatDate(r.submitted_at) : "Not sent"],
            ["Invoice", r.invoice ? <Button key="i" size="sm" icon="doc" onClick={() => saveFile(`/api/v1/documents/${r.invoice!.document_id}/content`, r.invoice!.file_name)}>Open Invoice</Button> : "None"],
          ]}
        />
      </div>
      {r.possible_duplicates.length + r.possible_duplicates_hidden > 0 && (
        <div className="mt-3">
          <CardHeader title="Possible Duplicates" right={r.possible_duplicates.length > 0 && <Button size="sm" icon="spark" onClick={check}>Check Duplicate</Button>} />
          {r.possible_duplicates.map((o) => (
            <Sub key={o.expense_request_id}>{o.number}, {o.purpose}, <Money value={o.amount} /></Sub>
          ))}
          {r.possible_duplicates_hidden > 0 && <Sub>{r.possible_duplicates_hidden === 1 ? "1 request you cannot open" : `${r.possible_duplicates_hidden} requests you cannot open`}</Sub>}
          {verdict && <p className="mt-1 text-xs font-semibold">{verdict.line}</p>}
          {verdict?.why && <Details title="Duplicate Check">{verdict.why}</Details>}
        </div>
      )}
      {r.workflow_instance_id && (
        <div className="mt-3">
          <RouteCard instanceId={r.workflow_instance_id} />
        </div>
      )}
      <div className="mt-3">
        <CardHeader title="History" />
        <History id={id} />
      </div>
      {actions && <div className="mt-3">{actions(r)}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * A decision's reason
 * ------------------------------------------------------------------ */

/** Send Back and Reject on the approval's own routes, each with its reason. */
export function DecisionForm({ instanceId, verb, close, onDone }: { instanceId: string; verb: "reject" | "request-changes"; close: () => void; onDone: () => void }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const back = useMutation("POST /api/v1/workflow/instances/:id/request-changes");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await (verb === "reject" ? reject : back).run({ params: { id: instanceId }, body: { reason: f.values.reason.trim() } });
      close();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Add the invoice" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{verb === "reject" ? "Reject Request" : "Send Back"}</Button>
      </FormFooter>
    </>
  );
}

/** Withdraw: an `expenses.finance` holder takes back an approved request before it is paid, with a reason. */
export function WithdrawForm({ r, close, onDone }: { r: ExpenseRequest; close: () => void; onDone: () => void }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const withdraw = useMutation("POST /api/v1/expenses/:id/withdraw");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await withdraw.run({ params: { id: r.expense_request_id }, body: { reason: f.values.reason.trim() } });
      refreshAll();
      close();
      onDone();
      toast(`${r.number} withdrawn`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Paid by cash" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Withdraw Request</Button>
      </FormFooter>
    </>
  );
}

/** A request the person may still cancel themselves; after approval only Withdraw takes it back. */
const CANCELLABLE: ReadonlyArray<ExpenseRow["status"]> = ["draft", "sent_back", "submitted"];

/**
 * The reader's actions on a request: Edit or Send Again and Cancel Request on their own, or
 * Withdraw for an `expenses.finance` holder once it is approved (docs/guides/expenses.md §4).
 */
export function OwnActions({ r, close }: { r: ExpenseRequest; close: () => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const cancel = useMutation("POST /api/v1/expenses/mine/:id/cancel");
  const send = useMutation("POST /api/v1/expenses/mine/:id/submit");
  if (!r.can_edit && !r.can_cancel) return null;
  const cancels = CANCELLABLE.includes(r.status);
  const cancelIt = async () => {
    if (!(await confirm({ title: "Cancel Request", body: `${r.number} stops here.`, confirmLabel: "Cancel Request", cancelLabel: "Keep Request", destructive: true }))) return;
    try {
      await cancel.run({ params: { id: r.expense_request_id }, body: {} });
      refreshAll();
      close();
      toast(`${r.number} cancelled`);
    } catch (e) {
      say(e);
    }
  };
  const withdrawIt = async () => {
    if (!(await confirm({ title: "Withdraw Request", body: `${r.number} will not be paid.`, confirmLabel: "Withdraw Request", cancelLabel: "Keep Request", destructive: true }))) return;
    modal.open({ title: "Withdraw Request", body: (c) => <WithdrawForm r={r} close={c} onDone={close} /> });
  };
  return (
    <ActionGroup>
      {r.can_edit && <Button onClick={async () => { close(); modal.open({ title: "Edit Request", wide: true, body: (c) => <RequestForm close={c} existing={r} /> }); }}>Edit Request</Button>}
      {r.can_edit && (
        <Button variant="primary" onClick={async () => { try { await send.run({ params: { id: r.expense_request_id }, body: {} }); refreshAll(); close(); toast(`${r.number} sent`); } catch (e) { say(e); } }}>
          {r.status === "sent_back" ? "Send Again" : "Send Request"}
        </Button>
      )}
      {r.can_cancel && cancels && <Button variant="danger" onClick={cancelIt}>Cancel Request</Button>}
      {r.can_cancel && !cancels && <Button variant="danger" onClick={withdrawIt}>Withdraw</Button>}
    </ActionGroup>
  );
}
