import attendance from "@mycity/contract/schemas/attendance.js";
import type { OvertimeDecision, PayItem, PayItemStatus } from "@mycity/contract/contract.gen.ts";
import { useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import { RESTRICTED_HELP } from "@/features/people/status";
import { Button, Chips, DataView, type DataViewColumn, EmptyValue, Field, type FieldBinding, formatDate, FormFooter, HelpTerm, KeyValue, type KeyValueItem, Money, NumberField, Pill, TextAreaField, toast, useContractForm, useModal, Who } from "@mycity/ui";
import { lateBy, PAY_AMOUNT_HELP, PAY_KIND, PAY_METHOD, PAY_STATUS } from "./labels";

/**
 * Pending deductions and overtime (docs/guides/attendance.md §6.17, §10): an item's amount and
 * details as My Attendance and People · Attendance show them, and People's Deductions and Overtime
 * views, where a deduction is waived (one, or up to 25 ticked) and a pending overtime item confirmed,
 * confirmed for fewer minutes, or cut. Who may decide is the API's: `can_decide` says this reader may.
 */

/** An item's amount: the figure; No Salary Set with no gross; Restricted where the salary is masked from the reader. */
export function payAmount(x: Pick<PayItem, "pay_amount" | "salary_set">): ReactNode {
  if (x.pay_amount !== null) return <Money value={x.pay_amount} />;
  if (!x.salary_set) return <Pill tone="neutral">No Salary Set</Pill>;
  return (
    <span className="text-subtle-foreground">
      <HelpTerm help={RESTRICTED_HELP}>Restricted</HelpTerm>
    </span>
  );
}

const statusPill = (x: Pick<PayItem, "status">) => <Pill tone={PAY_STATUS[x.status].tone}>{PAY_STATUS[x.status].text}</Pill>;

/** An item's details, as its sheet shows them: the Method a phone leaves off the card, a waived or cut one's reason. */
export function payDetails(x: PayItem, { person = false } = {}): KeyValueItem[] {
  return [
    ...(person ? ([["Employee", x.employee.display_name]] as KeyValueItem[]) : []),
    ["Date", formatDate(x.work_date)],
    ["Kind", PAY_KIND[x.kind]],
    ["Minutes", lateBy(x.minutes)],
    ...(x.kind === "overtime" && x.status !== "pending" && x.confirmed_minutes !== null ? ([["Confirmed", x.confirmed_minutes ? lateBy(x.confirmed_minutes) : <EmptyValue key="c" />]] as KeyValueItem[]) : []),
    ["Method", PAY_METHOD[x.method]],
    [<HelpTerm key="a" help={PAY_AMOUNT_HELP}>Amount</HelpTerm>, payAmount(x)],
    ["Status", statusPill(x)],
    ...(x.reason ? ([["Reason", x.reason]] as KeyValueItem[]) : []),
    ...(x.decided_by_name ? ([["Decided By", x.decided_by_name]] as KeyValueItem[]) : []),
  ];
}

/** The columns of a list of items; `person` adds who it is about, `kind` the kind (deductions only). */
export function payColumns({ person, kind }: { person: boolean; kind: boolean }): DataViewColumn<PayItem>[] {
  return [
    ...(person ? [{ key: "e", label: "Employee", render: (x: PayItem) => <Who name={x.employee.display_name} sub={x.employee.department} /> }] : []),
    { key: "work_date", label: "Date", sortable: person, render: (x) => formatDate(x.work_date) },
    ...(kind ? [{ key: "kind", label: "Kind", render: (x: PayItem) => PAY_KIND[x.kind] }] : []),
    { key: "minutes", label: "Minutes", sortable: person, align: "n", render: (x) => lateBy(x.minutes) },
    { key: "method", label: "Method", desktop: true, render: (x) => PAY_METHOD[x.method] },
    { key: "amount", label: <HelpTerm help={PAY_AMOUNT_HELP}>Amount</HelpTerm>, align: "n", render: payAmount },
    { key: "status", label: "Status", render: statusPill },
  ];
}

/** The help on the Deductions list's title (tier 2): what Waive Selected does. */
const WAIVE_HELP = "Waive Selected restores the pay. The day still counts toward the policy's limits.";

const DEDUCTION_CHIPS: Array<[PayItemStatus | "all", string]> = [
  ["pending", "Pending"],
  ["waived", "Waived"],
  ["all", "All"],
];
const OVERTIME_CHIPS: Array<[PayItemStatus | "all", string]> = [
  ["pending", "Pending"],
  ["confirmed", "Confirmed"],
  ["cut", "Cut"],
  ["all", "All"],
];

/**
 * People · Attendance's Deductions or Overtime view: the items within the reader's scope, pending
 * first. Deductions are ticked to waive in a batch; the page's floating button offers the batch's
 * Waive Selected (`waiveRef`, and `onCanWaive` while something waivable is ticked).
 */
export function PayItemsView({ group, waiveRef, onCanWaive }: { group: "deductions" | "overtime"; waiveRef: MutableRefObject<(() => void) | null>; onCanWaive: (can: boolean) => void }) {
  const modal = useModal();
  const deductions = group === "deductions";
  const [status, setStatus] = useState<PayItemStatus | "all">("pending");
  const [picked, setPicked] = useState<string[]>([]);
  const list = usePaged("GET /api/v1/attendance/pay-items", { filters: { group, ...(status !== "all" && { status }) } });
  const open = (x: PayItem) => modal.open({ title: PAY_KIND[x.kind], body: (close) => <PayItemView x={x} close={close} /> });
  // Only what this reader may waive is sent: never their own, never one already decided.
  const waivable = list.rows.filter((x) => picked.includes(x.attendance_pay_item_id) && x.can_decide).map((x) => x.attendance_pay_item_id);
  const waive = () => modal.open({ title: "Waive Selected", body: (close) => <WaiveForm ids={waivable} close={close} onDone={() => setPicked([])} /> });
  useEffect(() => {
    waiveRef.current = waive;
  });
  const canWaive = deductions && waivable.length > 0;
  useEffect(() => {
    onCanWaive(canWaive);
    return () => onCanWaive(false);
  }, [canWaive, onCanWaive]);
  const anyDecidable = deductions && list.rows.some((x) => x.can_decide);
  return (
    <>
      <Chips label={deductions ? "Deductions" : "Overtime"} value={status} onChange={(s) => (setStatus(s), setPicked([]))} options={deductions ? DEDUCTION_CHIPS : OVERTIME_CHIPS} />
      <DataView
        title={deductions ? "Deductions" : "Overtime"}
        help={deductions ? WAIVE_HELP : undefined}
        list={list}
        search="Name"
        rowKey={(x) => x.attendance_pay_item_id}
        onRowClick={open}
        noun={deductions ? "deduction" : "overtime item"}
        empty={{ icon: "check", title: "Nothing Here", text: "Choose All to see every item." }}
        selection={
          anyDecidable
            ? {
                keys: picked,
                onChange: setPicked,
                actions: (
                  <Button variant="primary" icon="check" onClick={waive}>
                    Waive Selected
                  </Button>
                ),
              }
            : undefined
        }
        columns={payColumns({ person: true, kind: deductions })}
      />
    </>
  );
}

/** One item, opened: its details, Waive Deduction on a pending deduction, Confirm and Cut on pending overtime. */
function PayItemView({ x, close }: { x: PayItem; close: () => void }) {
  return (
    <>
      <KeyValue items={payDetails(x, { person: true })} />
      {x.can_decide && x.kind !== "overtime" ? (
        <WaiveForm ids={[x.attendance_pay_item_id]} close={close} />
      ) : x.can_decide ? (
        <OvertimeForm x={x} close={close} />
      ) : (
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      )}
    </>
  );
}

/** Waive one deduction or a batch, with the reason the person reads; the pay is restored, the day still counts. */
function WaiveForm({ ids, close, onDone }: { ids: string[]; close: () => void; onDone?: () => void }) {
  const f = useContractForm({ reason: "" }, { safeParse: (v: { reason: string }) => attendance.PayItemWaive.safeParse({ pay_item_ids: ids, reason: v.reason }) });
  const save = useMutation("POST /api/v1/attendance/pay-items/waive");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const out = await save.run({ body: { pay_item_ids: ids, reason: f.values.reason.trim() } });
      invalidate("/api/v1/attendance");
      onDone?.();
      close();
      toast(out.waived.length === 1 ? "Deduction waived" : `${out.waived.length} deductions waived`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Nothing waived");
    }
  };
  return (
    <>
      <Field label="Reason" className="mt-3" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Bridge closed" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          {ids.length === 1 ? "Waive Deduction" : "Waive Deductions"}
        </Button>
      </FormFooter>
    </>
  );
}

type OvertimeValues = { minutes: string; reason: string };

/** The body a press sends: Confirm (all, or the minutes given) or Cut (with its reason). */
function decisionOf(decision: OvertimeDecision["decision"], v: OvertimeValues): OvertimeDecision {
  const reason = v.reason.trim();
  if (decision === "cut") return { decision, reason };
  return { decision, ...(v.minutes.trim() && { minutes: Number(v.minutes) }), ...(reason && { reason }) };
}

/** Confirm a pending overtime item (all of it, or fewer minutes) or cut it with a reason (Line Manager After). */
function OvertimeForm({ x, close }: { x: PayItem; close: () => void }) {
  const [pressed, setPressed] = useState<OvertimeDecision["decision"]>("confirm");
  const f = useContractForm<OvertimeValues>({ minutes: String(x.minutes), reason: "" }, { safeParse: (v: OvertimeValues) => attendance.OvertimeDecision.safeParse(decisionOf(pressed, v)) });
  const save = useMutation("POST /api/v1/attendance/pay-items/:id/overtime");
  const decide = async (decision: OvertimeDecision["decision"]) => {
    setPressed(decision);
    const body = decisionOf(decision, f.values);
    const checked = attendance.OvertimeDecision.safeParse(body);
    if (!checked.success) {
      f.setServerErrors(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? "_"), [i.message]])));
      return;
    }
    try {
      const out = await save.run({ params: { id: x.attendance_pay_item_id }, body });
      invalidate("/api/v1/attendance");
      close();
      toast(out.status === "cut" ? "Overtime cut" : "Overtime confirmed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Overtime not decided");
    }
  };
  return (
    <>
      <Field label="Minutes" className="mt-3" {...f.status("minutes")}>
        <NumberField {...(f.field("minutes") as FieldBinding<string> & { name: string })} className="w-28" />
      </Field>
      <Field label="Reason" optional {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Not agreed beforehand" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button onClick={() => decide("cut")}>Cut</Button>
        <Button variant="primary" onClick={() => decide("confirm")}>
          Confirm
        </Button>
      </FormFooter>
    </>
  );
}

/** Approve Overtime on a person's day beforehand (Pre-Approved): the minutes, and why. */
export function ApproveOvertimeForm({ employeeId, date, close }: { employeeId: string; date: string; close: () => void }) {
  type Values = { minutes: string; reason: string };
  const bodyOf = (v: Values) => ({ employee_id: employeeId, work_date: date, minutes: v.minutes.trim() ? Number(v.minutes) : Number.NaN, reason: v.reason.trim() });
  const f = useContractForm<Values>({ minutes: "", reason: "" }, { safeParse: (v: Values) => attendance.OvertimePreApprovalCreate.safeParse(bodyOf(v)) });
  const save = useMutation("POST /api/v1/attendance/overtime-approvals");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: bodyOf(f.values) });
      invalidate("/api/v1/attendance");
      close();
      toast("Overtime approved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Overtime not approved");
    }
  };
  return (
    <>
      <KeyValue items={[["Date", formatDate(date)]]} />
      <Field label="Minutes" className="mt-3" {...f.status("minutes")}>
        <NumberField {...(f.field("minutes") as FieldBinding<string> & { name: string })} className="w-28" />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Month-end close" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          Approve Overtime
        </Button>
      </FormFooter>
    </>
  );
}
