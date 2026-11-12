/**
 * One onboarding case (docs/guides/offers.md §3 steps 5a to 8, §10): the hire, where the case stands
 * and what documentation still waits on; the checklist with Verify and Reject on what the hire sent;
 * the two guarantors with Record Check; the employment contract with Sign for Company and Resend
 * Contract; and, from the start date, the plan's steps with Mark Step Done. Send Reminder, Complete
 * Onboarding and Withdraw Hire sit on the case's own card. What a person may do comes from the
 * record: its status, `can_complete`, `can_withdraw` and the contract's `can_sign` and `can_resend`.
 * `wide` (the desktop dialog): the case beside its contract, then the checklist, the guarantors (side
 * by side) and the plan across the dialog; a phone's sheet stacks them all.
 */
import { useState } from "react";
import onboardingSchemas from "@mycity/contract/schemas/onboarding.js";
import type { EmploymentContractView, GateCondition, Guarantor, OnboardingDetail, OnboardingItem, OnboardingStatus, OnboardingStep, SignerView } from "@mycity/contract/contract.gen.ts";
import { saveFile } from "@/api/download";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useFileViewer, viewableFile } from "@/features/shared/files";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DataView,
  ErrorState,
  Field,
  FormError,
  FormFooter,
  formatDate,
  formatDateTime,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  Meter,
  Pill,
  Stack,
  TextAreaField,
  TextField,
  toast,
  useContractForm,
  useModal,
  type StatusTone,
} from "@mycity/ui";
import { CompanySignForm } from "./OfferSign";
import { pill, say, sayRefusal } from "./shared";

export const CASE_STATUS: Record<OnboardingStatus, [StatusTone, string]> = {
  documentation: ["warn", "Documentation"],
  pre_onboarding: ["info", "Pre-Onboarding"],
  onboarding: ["info", "Onboarding"],
  completed: ["ok", "Completed"],
  cancelled: ["neutral", "Cancelled"],
};

const ITEM_STATUS: Record<OnboardingItem["status"], [StatusTone, string]> = {
  pending: ["neutral", "Not Sent"],
  uploaded: ["warn", "To Verify"],
  verified: ["ok", "Verified"],
  rejected: ["err", "Rejected"],
};

const CHECK_STATUS: Record<Guarantor["check_status"], [StatusTone, string]> = {
  pending: ["warn", "To Check"],
  passed: ["ok", "Passed"],
  failed: ["err", "Failed"],
};

const CONTRACT_STATUS: Record<EmploymentContractView["status"], [StatusTone, string]> = {
  draft: ["neutral", "Draft"],
  sent: ["warn", "With Hire"],
  signed: ["ok", "Signed"],
  cancelled: ["neutral", "Cancelled"],
};

const GATE: Record<GateCondition, string> = { documents: "documents", guarantors: "guarantors", bvn: "BVN", contract: "contract" };
const KIND: Record<Guarantor["kind"], string> = { previous_employer: "Previous Employer", personal: "Personal" };
const OWNER: Record<OnboardingStep["owner_role"], string> = { case_owner: "Case Owner", line_manager: "Line Manager", head_of_department: "Head of Department", hire: "The Hire" };

const PRE_HELP = "Every required document verified, both guarantors passed, the BVN entered and the contract signed. The case then waits for the start date.";
const BVN_HELP = "The hire enters it once on their upload page. It is kept masked on their record and never shown here.";

const listed = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function OnboardingCase({ id, wide = false }: { id: string; wide?: boolean }) {
  const read = useApi("GET /api/v1/recruitment/onboarding/:id", { params: { id } });
  const files = useFileViewer();
  const c = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!c) return <Card><LoadingRows count={8} /></Card>;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/onboarding");
  };
  const view = (doc: { document_id: string; file_name: string; mime_type: string }, at?: string | null) => {
    const url = `/api/v1/documents/${doc.document_id}/content`;
    if (viewableFile(doc.mime_type)) files.view(url, { name: doc.file_name, mime: doc.mime_type, at: at ? `Sent ${formatDate(at)}` : null });
    else void saveFile(url, doc.file_name);
  };
  const atDocs = c.status === "documentation";
  const head = [<CaseCard key="case" c={c} onChanged={reload} />, c.contract ? <ContractCard key="contract" contract={c.contract} onChanged={reload} /> : null].filter(Boolean);
  // The case and its contract side by side in the dialog; the checklist, guarantors and plan across it.
  return (
    <Stack>
      {wide ? (
        <Grid cols={2} scroll={false} flush>
          {head}
        </Grid>
      ) : (
        head
      )}
      <ItemsCard c={c} open={atDocs} onChanged={reload} onView={view} />
      <GuarantorsCard c={c} open={atDocs} onChanged={reload} onView={view} wide={wide} />
      {c.steps.length > 0 && <StepsCard c={c} onChanged={reload} />}
      {files.viewer}
    </Stack>
  );
}

/** The hire, the case's status and what it waits on, and the case's own actions. */
function CaseCard({ c, onChanged }: { c: OnboardingDetail; onChanged: () => void }) {
  const modal = useModal();
  const remind = useMutation("POST /api/v1/recruitment/onboarding/:id/remind");
  const first = c.hire_name.split(" ")[0] ?? c.hire_name;
  const sendReminder = async () => {
    try {
      await remind.run({ params: { id: c.onboarding_case_id }, body: {} });
      onChanged();
      toast(`A fresh link is on its way to ${first}`);
    } catch (e) {
      say(e);
    }
  };
  const complete = () => modal.open({ title: "Complete Onboarding", body: (close) => <CompleteForm c={c} close={close} onSaved={onChanged} /> });
  const withdraw = () => modal.open({ title: "Withdraw Hire", body: (close) => <WithdrawForm c={c} close={close} onSaved={onChanged} /> });
  const pre = c.documentation_completed_at
    ? `Reached ${formatDate(c.documentation_completed_at)}`
    : c.status === "documentation"
      ? `Waiting on ${listed(c.waiting_on.map((w) => GATE[w]))}`
      : "Not reached";
  return (
    <Card as="article">
      <CardHeader record title={c.hire_name} right={pill(CASE_STATUS[c.status])} />
      <KeyValue
        items={[
          ["Role", c.job_title],
          ["Department", c.department ?? "–"],
          ["Start Date", c.starts_on ? formatDate(c.starts_on) : "–"],
          [<HelpTerm key="p" help={PRE_HELP}>Pre-Onboarding</HelpTerm>, pre],
          [<HelpTerm key="b" help={BVN_HELP}>BVN</HelpTerm>, c.bvn_entered ? pill(["ok", "Entered"]) : pill(["warn", "Not Entered"])],
          ["Privacy Notice", c.privacy_acknowledged_at ? `Accepted ${formatDate(c.privacy_acknowledged_at)}` : "Not accepted"],
          ...(c.completed_at ? [["Completed", formatDateTime(c.completed_at)] as [string, string]] : []),
          ...(c.cancelled_at ? [["Cancelled", formatDateTime(c.cancelled_at)] as [string, string]] : []),
          ...(c.end_reason ? [["Reason", <span key="r" data-copy="content">{c.end_reason}</span>] as [string, React.ReactNode]] : []),
        ]}
      />
      {(c.status === "documentation" || c.can_withdraw || c.can_complete) && (
        <ActionGroup>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {c.can_withdraw && <Button variant="danger" onClick={withdraw}>Withdraw Hire</Button>}
            {c.status === "documentation" && <Button icon="bell" onClick={sendReminder}>Send Reminder</Button>}
            {c.can_complete && <Button variant="primary" icon="check" className="max-md:w-full" onClick={complete}>Complete Onboarding</Button>}
          </div>
        </ActionGroup>
      )}
    </Card>
  );
}

/** The checklist: each item's state, the file or value the hire sent, and Verify and Reject on it. */
function ItemsCard({ c, open, onChanged, onView }: { c: OnboardingDetail; open: boolean; onChanged: () => void; onView: (d: NonNullable<OnboardingItem["document"]>, at?: string | null) => void }) {
  const modal = useModal();
  const verify = useMutation("POST /api/v1/recruitment/onboarding/:id/items/:item_id/verify");
  const required = c.items.filter((i) => i.required);
  const done = required.filter((i) => i.status === "verified").length;
  const pct = required.length ? Math.round((done * 100) / required.length) : 100;
  const ok = async (it: OnboardingItem) => {
    try {
      await verify.run({ params: { id: c.onboarding_case_id, item_id: it.onboarding_checklist_item_id }, body: {} });
      onChanged();
      toast(`${it.title} verified`);
    } catch (e) {
      say(e);
    }
  };
  const no = (it: OnboardingItem) => modal.open({ title: "Reject Document", body: (close) => <RejectForm c={c} item={it} close={close} onSaved={onChanged} /> });
  return (
    <DataView<OnboardingItem>
      title="Documents"
      right={<span className="w-36"><Meter pct={pct} label={`${done} of ${required.length}`} /></span>}
      rows={c.items}
      rowKey={(i) => i.onboarding_checklist_item_id}
      empty={{ title: "No Documents Asked", icon: "doc" }}
      columns={[
        {
          key: "title",
          label: "Document",
          render: (i) => (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{i.title}</span>
              {!i.required && <Pill dot={false}>Optional</Pill>}
            </span>
          ),
        },
        { key: "status", label: "Status", render: (i) => pill(ITEM_STATUS[i.status]) },
        {
          key: "sent",
          label: "Sent",
          desktop: true,
          render: (i) => (i.entered_value ? <span data-copy="content">{i.entered_value}</span> : i.uploaded_at ? formatDate(i.uploaded_at) : null),
        },
        {
          key: "do",
          label: "Actions",
          render: (i) => (
            <span className="flex flex-wrap justify-end gap-2" data-copy="content">
              {i.rejected_reason && i.status === "rejected" && <span className="text-xs text-subtle-foreground">{i.rejected_reason}</span>}
              {i.document && <Button size="sm" icon="eye" onClick={() => onView(i.document!, i.uploaded_at)}>View File</Button>}
              {open && i.status === "uploaded" && (
                <ActionGroup>
                  <Button size="sm" variant="danger" onClick={() => no(i)}>Reject</Button>
                  <Button size="sm" variant="primary" className="max-md:w-full" onClick={() => ok(i)}>Verify</Button>
                </ActionGroup>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}

/** The two guarantors the hire entered, their forms, and each reference check. */
function GuarantorsCard({ c, open, onChanged, onView, wide }: { c: OnboardingDetail; open: boolean; onChanged: () => void; onView: (d: NonNullable<Guarantor["form"]>) => void; wide: boolean }) {
  const modal = useModal();
  const check = (g: Guarantor) => modal.open({ title: "Record Check", body: (close) => <CheckForm c={c} g={g} close={close} onSaved={onChanged} /> });
  return (
    <Card>
      <CardHeader title="Guarantors" right={<span className="text-sm text-subtle-foreground">{c.guarantors.filter((g) => g.check_status === "passed").length} of 2 passed</span>} />
      {c.guarantors.length === 0 ? (
        <p className="text-sm text-subtle-foreground">Not entered yet</p>
      ) : (
        <div className={wide ? "grid grid-cols-2 gap-6" : "flex flex-col gap-4"}>
          {c.guarantors.map((g) => (
            <section key={g.onboarding_guarantor_id} aria-label={g.full_name} className={wide ? "" : "border-t border-border pt-3 first:border-t-0 first:pt-0"}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold" data-copy="content">{g.full_name}</span>
                {pill(CHECK_STATUS[g.check_status])}
              </div>
              <KeyValue
                items={[
                  ["Kind", KIND[g.kind]],
                  ["Relationship", <span key="r" data-copy="content">{g.relationship}</span>],
                  ...(g.organisation ? [["Organisation", <span key="o" data-copy="content">{g.organisation}</span>] as [string, React.ReactNode]] : []),
                  ["Phone", g.phone],
                  ...(g.email ? [["Email", g.email] as [string, string]] : []),
                  ...(g.years_known !== null ? [["Years Known", String(g.years_known)] as [string, string]] : []),
                  ...(g.check_note ? [["Check Note", <span key="n" data-copy="content">{g.check_note}</span>] as [string, React.ReactNode]] : []),
                ]}
              />
              <ActionGroup>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {g.form && <Button size="sm" icon="eye" onClick={() => onView(g.form!)}>View Form</Button>}
                  {open && g.check_status !== "passed" && <Button size="sm" variant="primary" onClick={() => check(g)}>Record Check</Button>}
                </div>
              </ActionGroup>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/** The employment contract: its signers, the PDF, Sign for Company and Resend Contract. */
function ContractCard({ contract: k, onChanged }: { contract: EmploymentContractView; onChanged: () => void }) {
  const modal = useModal();
  const sign = useMutation("POST /api/v1/recruitment/contracts/:id/sign");
  const resend = useMutation("POST /api/v1/recruitment/contracts/:id/resend");
  const signFor = () =>
    modal.open({
      title: "Sign for the Company",
      wide: true,
      body: (close) => (
        <CompanySignForm
          signers={k.signers}
          label="Sign Contract"
          close={close}
          submit={async (body) => {
            await sign.run({ params: { id: k.employment_contract_id }, body });
            onChanged();
            toast(`${k.number} signed for the company`);
          }}
        />
      ),
    });
  const again = async () => {
    try {
      await resend.run({ params: { id: k.employment_contract_id }, body: {} });
      onChanged();
      toast("A new link is on its way");
    } catch (e) {
      say(e);
    }
  };
  const pdf = () => saveFile(`/api/v1/recruitment/contracts/${k.employment_contract_id}/document`, k.document.file_name);
  return (
    <Card>
      <CardHeader title="Contract" right={pill(CONTRACT_STATUS[k.status])} />
      <KeyValue
        items={[
          ["Number", k.number],
          ["Starts", formatDate(k.starts_on)],
          ...k.signers.map((s) => [s.role === "mycity" ? `For the Company${s.title ? `, ${s.title}` : ""}` : "Hire", signerState(s)] as [string, React.ReactNode]),
        ]}
      />
      <ActionGroup>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button icon="download" onClick={pdf}>Download PDF</Button>
          {k.can_resend && <Button icon="send" onClick={again}>Resend Contract</Button>}
          {k.can_sign && <Button variant="primary" icon="signature" className="max-md:w-full" onClick={signFor}>Sign for Company</Button>}
        </div>
      </ActionGroup>
    </Card>
  );
}

function signerState(s: SignerView) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {s.name}
      {s.status === "signed" ? pill(["ok", s.signed_at ? `Signed ${formatDate(s.signed_at)}` : "Signed"]) : s.status === "pending" ? pill(["warn", "Waiting"]) : pill(["neutral", s.status === "declined" ? "Declined" : "Not Signed"])}
    </span>
  );
}

/** The plan's steps on the case, from the start date: owner, due day, SOP, and Mark Step Done. */
function StepsCard({ c, onChanged }: { c: OnboardingDetail; onChanged: () => void }) {
  const done = useMutation("POST /api/v1/recruitment/onboarding/:id/steps/:step_id/done");
  const mark = async (s: OnboardingStep) => {
    try {
      await done.run({ params: { id: c.onboarding_case_id, step_id: s.onboarding_case_step_id }, body: {} });
      onChanged();
      toast(`${s.title} done`);
    } catch (e) {
      say(e);
    }
  };
  const finished = c.steps.filter((s) => s.status === "done").length;
  return (
    <DataView<OnboardingStep>
      title="Onboarding Plan"
      right={<span className="w-36"><Meter pct={Math.round((finished * 100) / c.steps.length)} label={`${finished} of ${c.steps.length}`} /></span>}
      rows={c.steps}
      rowKey={(s) => s.onboarding_case_step_id}
      columns={[
        { key: "title", label: "Step", render: (s) => <span className="font-medium" data-copy="content">{s.title}</span> },
        { key: "owner", label: "Owner", render: (s) => s.owner_name ?? OWNER[s.owner_role] },
        { key: "due", label: "Due", desktop: true, render: (s) => (s.due_on ? formatDate(s.due_on) : null) },
        { key: "sop", label: "SOP", desktop: true, render: (s) => (s.sop ? <span data-copy="content">{`${s.sop.number} ${s.sop.title}`}</span> : null) },
        {
          key: "status",
          label: "Status",
          render: (s) => (s.status === "done" ? pill(["ok", s.done_at ? `Done ${formatDate(s.done_at)}` : "Done"]) : s.overdue ? pill(["err", "Overdue"]) : pill(["neutral", "Pending"])),
        },
        {
          key: "do",
          label: "Actions",
          render: (s) => (c.status === "onboarding" && s.status === "pending" ? <Button size="sm" className="max-md:w-full" onClick={() => mark(s)}>Mark Step Done</Button> : null),
        },
      ]}
    />
  );
}

function RejectForm({ c, item, close, onSaved }: { c: OnboardingDetail; item: OnboardingItem; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ reason: "" }, onboardingSchemas.ChecklistItemReject);
  const run = useMutation("POST /api/v1/recruitment/onboarding/:id/items/:item_id/reject");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: c.onboarding_case_id, item_id: item.onboarding_checklist_item_id }, body: f.values });
      close();
      onSaved();
      toast(`${item.title} back with the hire`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" help="The hire reads it beside the document on their upload page." {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={save}>Reject Document</Button>
      </FormFooter>
    </>
  );
}

const OUTCOMES: Array<["passed" | "failed", string]> = [
  ["passed", "Passed"],
  ["failed", "Failed"],
];

function CheckForm({ c, g, close, onSaved }: { c: OnboardingDetail; g: Guarantor; close: () => void; onSaved: () => void }) {
  const f = useContractForm<{ check_status: "passed" | "failed"; check_note: string }>({ check_status: "passed", check_note: "" }, onboardingSchemas.ReferenceCheckRecord);
  const run = useMutation("POST /api/v1/recruitment/onboarding/:id/guarantors/:guarantor_id/check");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: c.onboarding_case_id, guarantor_id: g.onboarding_guarantor_id }, body: f.values });
      close();
      onSaved();
      toast(`${g.full_name}: check recorded`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Outcome" {...f.status("check_status")}>
        <ChoiceField options={OUTCOMES} {...f.field("check_status")} />
      </Field>
      <Field label="Note" optional {...f.status("check_note")}>
        <TextAreaField {...f.field("check_note")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>Record Check</Button>
      </FormFooter>
    </>
  );
}

/** Complete Onboarding: the hire's company email, their work email and their login's from now. */
function CompleteForm({ c, close, onSaved }: { c: OnboardingDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ work_email: "" }, onboardingSchemas.OnboardingComplete);
  const run = useMutation("POST /api/v1/recruitment/onboarding/:id/complete");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: c.onboarding_case_id }, body: f.values });
      close();
      onSaved();
      invalidate("/api/v1/employees");
      toast(`${c.hire_name} is hired`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Company Email" help="Their work email and the login they are invited on." {...f.status("work_email")}>
        <TextField {...f.field("work_email")} placeholder="name@mycityapp.io" autoComplete="off" />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>Complete Onboarding</Button>
      </FormFooter>
    </>
  );
}

function WithdrawForm({ c, close, onSaved }: { c: OnboardingDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ reason: "" }, onboardingSchemas.OnboardingCancel);
  const run = useMutation("POST /api/v1/recruitment/onboarding/:id/withdraw");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: c.onboarding_case_id }, body: f.values });
      close();
      onSaved();
      toast(`${c.hire_name} withdrawn`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Keep Hire</Button>
        <Button variant="danger" onClick={save}>Withdraw Hire</Button>
      </FormFooter>
    </>
  );
}
