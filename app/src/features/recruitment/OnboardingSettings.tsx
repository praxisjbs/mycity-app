/**
 * Onboarding Settings (docs/guides/offers.md §3 steps 5a, 6 and 8, §5; the address's
 * `panel=settings`): the Checklist (MyCity's New Joiner list: each document a hire sends, whether it
 * is required, a file, a typed value or both), the Plans (each department's onboarding steps, with
 * who owns each, its due day from the start date and an SOP in force; the plan with no department is
 * the company's default) and the Standard Contract (the employment contract's wording, kept as a new
 * version on every save; a contract keeps the version in force when it was generated).
 */
import { useState } from "react";
import contractSchemas from "@mycity/contract/schemas/employment_contracts.js";
import onboardingSchemas from "@mycity/contract/schemas/onboarding.js";
import type { DocumentRequirement, OnboardingPlan, OnboardingPlanRow, RequirementKind, StepOwnerRole } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import {
  Button,
  CheckboxField,
  ChoiceField,
  DataView,
  ErrorState,
  Field,
  formatDate,
  formatDateTime,
  FormError,
  FormFooter,
  Grid,
  IconButton,
  LoadingRows,
  NumberField,
  Pill,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useModal,
  useUnsavedChanges,
} from "@mycity/ui";
import { say, sayRefusal } from "./shared";

const KINDS: Array<[RequirementKind, string]> = [
  ["file", "File"],
  ["number", "Value"],
  ["both", "Both"],
];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<RequirementKind, string>;
const ROLES: Array<[StepOwnerRole, string]> = [
  ["case_owner", "Case Owner"],
  ["line_manager", "Line Manager"],
  ["head_of_department", "Head of Department"],
  ["hire", "The Hire"],
];

type Row = { key: "checklist" | "plans" | "contract"; name: string; value: string; changed: boolean };

/** The panel: three settings, each opening its own editor and coming back here when it closes. */
export function OnboardingSettingsPanel({ close }: { close: () => void }) {
  const modal = useModal();
  const reqs = useApi("GET /api/v1/recruitment/onboarding/requirements");
  const plans = useApi("GET /api/v1/recruitment/onboarding/plans");
  const contract = useApi("GET /api/v1/recruitment/contracts/settings/template");
  const failed = reqs.error ?? plans.error ?? contract.error;
  if (failed) return <ErrorState error={failed} onRetry={() => Promise.all([reqs.reload(), plans.reload(), contract.reload()])} />;
  const back = () => modal.open({ title: "Onboarding Settings", wide: true, body: (done) => <OnboardingSettingsPanel close={done} /> });
  const open = (r: Row) =>
    modal.open(
      r.key === "checklist"
        ? { title: "Checklist", wide: true, body: () => <ChecklistPanel close={back} /> }
        : r.key === "plans"
          ? { title: "Onboarding Plans", wide: true, body: () => <PlansPanel close={back} /> }
          : { title: "Standard Contract", wide: true, full: true, body: () => <ContractForm close={back} /> },
    );
  const ready = reqs.data && plans.data && contract.data;
  const rows: Row[] = ready
    ? [
        { key: "checklist", name: "Checklist", value: `${reqs.data!.page.total} ${reqs.data!.page.total === 1 ? "document" : "documents"}`, changed: false },
        { key: "plans", name: "Onboarding Plans", value: `${plans.data!.page.total} ${plans.data!.page.total === 1 ? "plan" : "plans"}`, changed: false },
        { key: "contract", name: "Standard Contract", value: `Version ${contract.data!.version}`, changed: !contract.data!.is_default },
      ]
    : [];
  return (
    <>
      {!ready ? (
        <LoadingRows count={3} />
      ) : (
        <DataView<Row>
          title="Onboarding Settings"
          rows={rows}
          rowKey={(r) => r.key}
          onRowClick={open}
          columns={[
            { key: "name", label: "Setting", render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: "value", label: "Now", render: (r) => r.value },
            { key: "state", label: "State", render: (r) => (r.key !== "contract" ? null : r.changed ? <Pill tone="info">Changed</Pill> : <Pill dot={false}>Default</Pill>) },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The Checklist
 * ------------------------------------------------------------------ */

function ChecklistPanel({ close }: { close: () => void }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/recruitment/onboarding/requirements", { sort: "display_order" });
  const back = () => modal.open({ title: "Checklist", wide: true, body: () => <ChecklistPanel close={close} /> });
  const edit = (r?: DocumentRequirement) => modal.open({ title: r ? r.name : "Add Document", body: () => <RequirementForm row={r ?? null} close={back} /> });
  return (
    <>
      <DataView<DocumentRequirement>
        title="Documents Asked"
        list={list}
        rowKey={(r) => r.document_requirement_id}
        noun="document"
        onRowClick={(r) => edit(r)}
        right={<Button size="sm" icon="plus" onClick={() => edit()}>Add Document</Button>}
        empty={{ title: "No Documents Yet", icon: "doc" }}
        columns={[
          { key: "name", label: "Document", render: (r) => <span className="font-medium" data-copy="content">{r.name}</span> },
          { key: "kind", label: "Takes", desktop: true, render: (r) => KIND_LABEL[r.kind] },
          { key: "required", label: "Required", render: (r) => (r.required ? <Pill tone="info" dot={false}>Required</Pill> : <Pill dot={false}>Optional</Pill>) },
          { key: "active", label: "State", render: (r) => (r.active ? <Pill tone="ok">Active</Pill> : <Pill dot={false}>Off</Pill>) },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Back</Button>
      </FormFooter>
    </>
  );
}

type ReqValues = { code: string; name: string; description: string; kind: RequirementKind; required: boolean; expires: boolean; active: boolean };

function RequirementForm({ row, close }: { row: DocumentRequirement | null; close: () => void }) {
  const f = useContractForm<ReqValues>(
    {
      code: row?.code ?? "",
      name: row?.name ?? "",
      description: row?.description ?? "",
      kind: row?.kind ?? "file",
      required: row?.required ?? true,
      expires: row?.expires ?? false,
      active: row?.active ?? true,
    },
    // A new requirement is made with its code; an edit never sends one (a code is kept once made).
    (row ? onboardingSchemas.DocumentRequirementEdit : onboardingSchemas.DocumentRequirementCreate) as never,
  );
  useUnsavedChanges(f.isDirty);
  const create = useMutation("POST /api/v1/recruitment/onboarding/requirements");
  const save = useMutation("PATCH /api/v1/recruitment/onboarding/requirements/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    const { code, active, ...rest } = f.values;
    try {
      if (row) await save.run({ params: { id: row.document_requirement_id }, body: { ...rest, active } });
      else await create.run({ body: { code, ...rest } });
      invalidate("/api/v1/recruitment/onboarding/requirements");
      close();
      toast(`${f.values.name} saved`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Grid cols={2}>
        <Field label="Name" {...f.status("name")}>
          <TextField {...f.field("name")} maxLength={120} />
        </Field>
        {!row && (
          <Field label="Code" help="Lowercase letters, digits and _. Kept once made." {...f.status("code")}>
            <TextField {...f.field("code")} placeholder="proof_of_address" maxLength={40} />
          </Field>
        )}
      </Grid>
      <Field label="Description" optional {...f.status("description")}>
        <TextAreaField {...f.field("description")} rows={2} />
      </Field>
      <Field label="Takes" {...f.status("kind")}>
        <ChoiceField options={KINDS} {...f.field("kind")} />
      </Field>
      <CheckboxField label="Required" {...f.field("required")} />
      <CheckboxField label="Expires" {...f.field("expires")} />
      {row && <CheckboxField label="Active" {...f.field("active")} />}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{row ? "Save Document" : "Add Document"}</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The Plans
 * ------------------------------------------------------------------ */

function PlansPanel({ close }: { close: () => void }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/recruitment/onboarding/plans");
  const back = () => modal.open({ title: "Onboarding Plans", wide: true, body: () => <PlansPanel close={close} /> });
  const edit = (r?: OnboardingPlanRow) => modal.open({ title: r ? r.name : "Add Plan", wide: true, full: true, body: () => <PlanEditor id={r?.onboarding_plan_id ?? null} close={back} /> });
  return (
    <>
      <DataView<OnboardingPlanRow>
        title="Plans"
        list={list}
        rowKey={(r) => r.onboarding_plan_id}
        noun="plan"
        onRowClick={(r) => edit(r)}
        right={<Button size="sm" icon="plus" onClick={() => edit()}>Add Plan</Button>}
        empty={{ title: "No Plans Yet", icon: "list" }}
        columns={[
          { key: "name", label: "Plan", render: (r) => <span className="font-medium" data-copy="content">{r.name}</span> },
          { key: "dept", label: "Department", render: (r) => r.department ?? "Company Default" },
          { key: "steps", label: "Steps", desktop: true, render: (r) => String(r.step_count) },
          { key: "active", label: "State", render: (r) => (r.active ? <Pill tone="ok">Active</Pill> : <Pill dot={false}>Off</Pill>) },
          { key: "updated", label: "Updated", desktop: true, render: (r) => formatDate(r.updated_at) },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Back</Button>
      </FormFooter>
    </>
  );
}

function PlanEditor({ id, close }: { id: string | null; close: () => void }) {
  const read = useApi("GET /api/v1/recruitment/onboarding/plans/:id", { params: { id: id ?? "" }, enabled: !!id });
  if (!id) return <PlanForm plan={null} close={close} />;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  return <PlanForm plan={read.data} close={close} />;
}

type StepValues = { title: string; description: string; owner_role: StepOwnerRole; due_offset_days: string; sop_id: string };
type PlanValues = { department_id: string | null; name: string; active: boolean; steps: StepValues[] };

const blankStep = (): StepValues => ({ title: "", description: "", owner_role: "case_owner", due_offset_days: "0", sop_id: "" });

function PlanForm({ plan, close }: { plan: OnboardingPlan | null; close: () => void }) {
  const isDefault = plan !== null && plan.department_id === null;
  const departments = useInfinite("GET /api/v1/departments", {});
  const sops = useInfinite("GET /api/v1/knowledge/sops", { filters: { state: "published" } });
  const f = useContractForm<PlanValues>(
    {
      department_id: plan ? plan.department_id : "",
      name: plan?.name ?? "",
      active: plan?.active ?? true,
      steps: plan?.steps.length
        ? plan.steps.map((s) => ({ title: s.title, description: s.description ?? "", owner_role: s.owner_role, due_offset_days: String(s.due_offset_days), sop_id: s.sop?.sop_id ?? "" }))
        : [blankStep()],
    },
    onboardingSchemas.OnboardingPlanSave as never,
  );
  useUnsavedChanges(f.isDirty);
  const create = useMutation("POST /api/v1/recruitment/onboarding/plans");
  const save = useMutation("PUT /api/v1/recruitment/onboarding/plans/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const steps = f.values.steps;
  // Each step row keeps one key for its life, so removing a step never hands its fields or its SOP's
  // label to the step below (the contract's steps carry no id of their own to key by).
  const [rowKeys, setRowKeys] = useState<number[]>(() => steps.map((_, i) => i));
  const [nextKey, setNextKey] = useState(steps.length);
  const setSteps = (next: StepValues[]) => f.set("steps", next);
  const put = (i: number, patch: Partial<StepValues>) => setSteps(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addStep = () => {
    setSteps([...steps, blankStep()]);
    setRowKeys([...rowKeys, nextKey]);
    setNextKey(nextKey + 1);
  };
  const removeStep = (i: number) => {
    setSteps(steps.filter((_, k) => k !== i));
    setRowKeys(rowKeys.filter((_, k) => k !== i));
  };
  // An SOP's label by its id: the plan's own (an SOP the menu has not loaded yet) and every one loaded.
  const sopLabel = new Map<string, string>();
  for (const st of plan?.steps ?? []) if (st.sop) sopLabel.set(st.sop.sop_id, `${st.sop.number} · ${st.sop.title}`);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    const body = {
      department_id: f.values.department_id || null,
      name: f.values.name,
      active: f.values.active,
      steps: steps.map((s) => ({ title: s.title, description: s.description, owner_role: s.owner_role, due_offset_days: Number(s.due_offset_days || 0), sop_id: s.sop_id })),
    };
    try {
      if (plan) await save.run({ params: { id: plan.onboarding_plan_id }, body });
      else await create.run({ body });
      invalidate("/api/v1/recruitment/onboarding/plans");
      close();
      toast(`${f.values.name} saved`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  const sopOptions = sops.rows.map((s) => [s.sop_id, `${s.number} · ${s.title}`] as [string, string]);
  for (const [sopId, label] of sopOptions) sopLabel.set(sopId, label);
  return (
    <>
      <Grid cols={2}>
        <Field label="Name" {...f.status("name")}>
          <TextField {...f.field("name")} maxLength={120} />
        </Field>
        {isDefault ? (
          <Field label="Department">
            <TextField value="Company Default" onChange={() => undefined} disabled />
          </Field>
        ) : (
          <Field label="Department" {...f.status("department_id")}>
            <SelectField
              searchable
              placeholder="Pick a department"
              options={departments.rows.map((d) => [d.department_id, d.name] as [string, string])}
              valueLabel={plan?.department ?? undefined}
              {...paging(departments)}
              value={f.values.department_id ?? ""}
              onChange={(v) => f.set("department_id", v)}
            />
          </Field>
        )}
      </Grid>
      <CheckboxField label="Active" {...f.field("active")} />
      <Field label="Steps" {...f.status("steps")}>
        <div className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <div key={rowKeys[i] ?? `new-${i}`} className="grid grid-cols-6 items-end gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 max-md:grid-cols-2">
              <span className="col-span-3 max-md:col-span-2">
                <Field label={`Step ${i + 1}`}>
                  <TextField name={`step-${i}-title`} value={s.title} onChange={(v) => put(i, { title: v })} maxLength={160} />
                </Field>
              </span>
              <span className="col-span-2 max-md:col-span-1">
                <Field label="Owner">
                  <SelectField name={`step-${i}-owner`} options={ROLES} value={s.owner_role} onChange={(v) => put(i, { owner_role: v as StepOwnerRole })} />
                </Field>
              </span>
              <span className="max-md:col-span-1">
                <Field label="Due Day">
                  <NumberField name={`step-${i}-due`} value={s.due_offset_days} onChange={(v) => put(i, { due_offset_days: v })} />
                </Field>
              </span>
              <span className="col-span-5 max-md:col-span-2">
                <Field label="SOP" optional>
                  <SelectField
                    name={`step-${i}-sop`}
                    searchable
                    placeholder="No SOP"
                    options={[["", "No SOP"], ...sopOptions]}
                    valueLabel={s.sop_id ? sopLabel.get(s.sop_id) : undefined}
                    {...paging(sops)}
                    value={s.sop_id}
                    onChange={(v) => put(i, { sop_id: v })}
                  />
                </Field>
              </span>
              {steps.length > 1 && (
                <span className="flex min-h-tap items-center">
                  <IconButton icon="trash" label={`Remove Step ${i + 1}`} onClick={() => removeStep(i)} />
                </span>
              )}
            </div>
          ))}
        </div>
      </Field>
      {steps.length < 40 && (
        <Button size="sm" icon="plus" onClick={addStep}>
          Add Step
        </Button>
      )}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Plan</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The Standard Contract
 * ------------------------------------------------------------------ */

function ContractForm({ close }: { close: () => void }) {
  const read = useApi("GET /api/v1/recruitment/contracts/settings/template");
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  return <ContractFields wording={read.data} close={close} />;
}

function ContractFields({ wording, close }: { wording: { body: string; version: number; is_default: boolean; variables: string[]; updated_at: string | null }; close: () => void }) {
  const f = useContractForm({ body: wording.body }, contractSchemas.ContractTemplateSave);
  useUnsavedChanges(f.isDirty);
  const save = useMutation("PUT /api/v1/recruitment/contracts/settings/template");
  const restore = useMutation("POST /api/v1/recruitment/contracts/settings/template/restore");
  const confirm = useConfirm();
  const [problem, setProblem] = useState<string | null>(null);
  const done = (said: string) => {
    invalidate("/api/v1/recruitment/contracts/settings/template");
    close();
    toast(said);
  };
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      done("Contract wording saved");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  const back = async () => {
    const yes = await confirm({ title: "Restore Default", body: "The shipped wording comes back. Yours stays in the history.", confirmLabel: "Restore Default" });
    if (!yes) return;
    try {
      await restore.run({ body: {} });
      done("Default wording restored");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Wording" help="Contracts generated from now on use it; contracts already generated keep theirs." {...f.status("body")}>
        <TextAreaField {...f.field("body")} rows={18} />
      </Field>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" data-copy="content">
        {wording.variables.map((v) => (
          <Pill key={v} dot={false}>{`{{ ${v} }}`}</Pill>
        ))}
      </div>
      <p className="text-xs text-subtle-foreground">{wording.updated_at ? `Version ${wording.version}, ${formatDateTime(wording.updated_at)}` : "Default wording"}</p>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {!wording.is_default && <Button onClick={back}>Restore Default</Button>}
        <Button variant="primary" onClick={submit}>Save Contract</Button>
      </FormFooter>
    </>
  );
}
