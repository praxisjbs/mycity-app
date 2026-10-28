import { useState } from "react";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { ApprovalFlow, ApprovalStage, ApprovalStageInput, StageCondition, UserRow } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { paging } from "@/features/shared/wire";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  ChoiceField,
  DataView,
  DateField,
  Field,
  FormError,
  FormFooter,
  formatMoney,
  HelpTerm,
  IconButton,
  Inline,
  KeyValue,
  MoneyField,
  NumberField,
  PageHeader,
  Pill,
  RecordPicker,
  SelectField,
  Stack,
  TextField,
  toast,
  toMoneyString,
  useContractForm,
  useModal,
  type ContractSchema,
} from "@mycity/ui";

/**
 * Settings · Approvals (#72; docs/guides/foundation.md §6.5, §10): every flow,
 * its stages and its version. Edit Stages changes a flow's stages one at a time
 * (approver, the condition on its numbers, the time limit) and Save Stages
 * writes them as a new version; a request already open keeps the version it
 * started on. No drag and drop: stages move with Move Up and Move Down.
 */
const CONDITION_HELP = "A stage runs only for requests that match. Others skip it and go to the next stage.";

const OPS: Array<[string, string]> = [[">", "Over"], [">=", "At Least"], ["<", "Under"], ["<=", "At Most"], ["=", "Exactly"]];
const OP_WORD: Record<string, string> = { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "is", in: "is one of" };
const APPROVERS: Array<[string, string]> = [["manager_of_subject", "Line Manager"], ["role", "Role"], ["user", "Person"], ["ceo", "CEO"]];
const NAMED: [string, string] = ["employee_in_context", "Named Person"];

/** The flow's fields that name a person: a named-person stage reads one of them. */
const personFields = (context: Record<string, string>) => Object.keys(context).filter((k) => context[k] === "uuid");

const fieldLabel = (key: string) => key.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const hours = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);
/** The most stages a flow takes (the contract's ApprovalStepsUpdate). */
const MAX_STAGES = 10;

function valueText(c: StageCondition, type: string | undefined): string {
  const one = (v: string | number | boolean) => (type === "money" ? formatMoney(String(v)) : String(v));
  return Array.isArray(c.value) ? c.value.map(one).join(", ") : one(c.value);
}

/** "Days over 5", or Always for a stage with no condition. */
function conditionText(stage: { condition: StageCondition[] }, context: Record<string, string>): string {
  if (!stage.condition.length) return "Always";
  return stage.condition.map((c) => `${fieldLabel(c.field)} ${OP_WORD[c.op] ?? c.op} ${valueText(c, context[c.field])}`).join(" and ");
}

/** A stage as the API stores it, as the body of a save. */
function asInput(s: ApprovalStage): ApprovalStageInput {
  return {
    key: s.key,
    name: s.name,
    approvers: s.approvers.map((a) => (a.value === null ? { type: a.type } : { type: a.type, value: a.value })) as ApprovalStageInput["approvers"],
    condition: s.condition,
    sla_hours: s.sla_hours,
    on_timeout: s.on_timeout as ApprovalStageInput["on_timeout"],
    on_approve: s.on_approve as ApprovalStageInput["on_approve"],
    on_reject: s.on_reject as ApprovalStageInput["on_reject"],
  };
}

export function Approvals() {
  const modal = useModal();
  const { can } = useAuth();
  const s = useApi("GET /api/v1/settings/approvals/summary");
  const list = usePaged("GET /api/v1/settings/approvals");
  const open = (f: ApprovalFlow) => modal.open({ title: f.name, side: true, body: (close) => <FlowDetail flow={f} close={close} editable={can("settings", "edit")} /> });
  return (
    <>
      <PageHeader title="Approvals" sub="Who decides each request" />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Flows", value: String(s.data.flows) },
            { label: "Open Requests", value: String(s.data.open_requests) },
            { label: "Overdue", value: String(s.data.overdue), tone: s.data.overdue ? "warn" : undefined },
            { label: "Needs Fixing", value: String(s.data.needs_fixing), tone: s.data.needs_fixing ? "err" : undefined },
          ]}
        />
      )}
      <DataView
        list={list}
        title="Approval Flows"
        search="Search Flows"
        noun="flow"
        rowKey={(f) => f.workflow_definition_id}
        onRowClick={open}
        empty={{ title: "No Flows Yet", icon: "check" }}
        columns={[
          { key: "name", label: "Flow", sortable: true, render: (f) => f.name },
          { key: "stages", label: "Stages", render: (f) => f.stages.map((x) => x.name).join(" · ") },
          { key: "version", label: "Version", align: "n", render: (f) => String(f.version) },
          { key: "open", label: "Open Requests", align: "n", render: (f) => String(f.open_requests) },
          { key: "status", label: "Status", render: (f) => (f.problems.length ? <Pill tone="err">Needs Fixing</Pill> : <Pill tone="ok">Active</Pill>) },
        ]}
      />
    </>
  );
}

/** One flow: its route, each stage, and Edit Stages. */
function FlowDetail({ flow, close, editable }: { flow: ApprovalFlow; close: () => void; editable: boolean }) {
  const modal = useModal();
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Pill>{`Version ${flow.version}`}</Pill>
        {flow.open_requests > 0 && <Pill tone="info">{`${flow.open_requests} Open`}</Pill>}
      </Inline>
      {flow.problems.length > 0 && (
        <Banner tone="err">
          <span className="block font-semibold">Fix these stages before the next request</span>
          <ul className="m-0 list-disc pl-4">
            {flow.problems.map((p) => (
              <li key={p} data-copy="content">{p}</li>
            ))}
          </ul>
        </Banner>
      )}
      <Chain steps={flow.stages.map((x) => ({ label: x.name }))} />
      {flow.stages.map((stage) => (
        <Card key={stage.key}>
          <CardHeader title={stage.name} record level={3} />
          <KeyValue
            items={[
              ["Approver", stage.approvers.map((a) => a.label).join(", ")],
              [<HelpTerm key="when" help={CONDITION_HELP}>Applies When</HelpTerm>, conditionText(stage, flow.context_types)],
              ["Time Limit", hours(stage.sla_hours)],
            ]}
          />
        </Card>
      ))}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {editable && (
          <Button variant="primary" icon="edit" onClick={() => modal.open({ title: "Edit Stages", wide: true, full: true, body: (done) => <EditStages flow={flow} close={done} /> })}>
            Edit Stages
          </Button>
        )}
      </FormFooter>
    </Stack>
  );
}

/** The stages of the version on screen, changed one at a time, then saved together as a new version. */
function EditStages({ flow, close }: { flow: ApprovalFlow; close: () => void }) {
  const [stages, setStages] = useState<ApprovalStageInput[]>(() => flow.stages.map(asInput));
  const [labels, setLabels] = useState<string[]>(() => flow.stages.map((x) => x.approvers.map((a) => a.label).join(", ")));
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("PUT /api/v1/settings/approvals/:id/steps");

  if (editing !== null) {
    const at = editing === "new" ? null : editing;
    return (
      <StageForm
        flow={flow}
        stage={at === null ? null : stages[at]}
        label={at === null ? "" : labels[at]}
        taken={stages.filter((_, i) => i !== at).map((x) => x.key)}
        onCancel={() => setEditing(null)}
        onDone={(stage, label) => {
          setStages((all) => (at === null ? [...all, stage] : all.map((x, i) => (i === at ? stage : x))));
          setLabels((all) => (at === null ? [...all, label] : all.map((x, i) => (i === at ? label : x))));
          setEditing(null);
        }}
      />
    );
  }

  const move = (i: number, d: number) => {
    const swap = <T,>(a: T[]) => {
      const n = [...a];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    };
    setStages(swap);
    setLabels(swap);
  };
  const remove = (i: number) => {
    setStages((a) => a.filter((_, j) => j !== i));
    setLabels((a) => a.filter((_, j) => j !== i));
  };
  const submit = async () => {
    setProblem(null);
    if (!stages.length) return setProblem("Keep at least one stage");
    try {
      const saved = await save.run({ params: { id: flow.workflow_definition_id }, body: { stages } });
      invalidate("/api/v1/settings/approvals");
      close();
      toast(`${saved.name} saved as version ${saved.version}`);
    } catch (e) {
      // A refused route names each stage's problem (workflow.service plainly); anything else, its message.
      setProblem(e instanceof ApiError ? (e.fields.stages?.join(" · ") ?? e.message) : "Not saved. Try again.");
    }
  };

  return (
    <>
      <Stack gap={2}>
        {stages.map((stage, i) => (
          <Card key={stage.key}>
            <CardHeader
              title={`${i + 1}. ${stage.name}`}
              record
              level={3}
              actions={
                <Inline gap={1}>
                  <IconButton icon="up" size="sm" label={`Move ${stage.name} Up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon="down" size="sm" label={`Move ${stage.name} Down`} disabled={i === stages.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon="edit" size="sm" label={`Edit ${stage.name}`} onClick={() => setEditing(i)} />
                  <IconButton icon="trash" size="sm" label={`Remove ${stage.name}`} disabled={stages.length === 1} onClick={() => remove(i)} />
                </Inline>
              }
            />
            <KeyValue
              items={[
                ["Approver", labels[i]],
                [<HelpTerm key="when" help={CONDITION_HELP}>Applies When</HelpTerm>, conditionText(stage, flow.context_types)],
                ["Time Limit", hours(stage.sla_hours)],
              ]}
            />
          </Card>
        ))}
        <div>
          {stages.length < MAX_STAGES ? (
            <Button icon="plus" onClick={() => setEditing("new")}>
              Add Stage
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{`At most ${MAX_STAGES} stages`}</p>
          )}
        </div>
      </Stack>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          Save Stages
        </Button>
      </FormFooter>
    </>
  );
}

interface StageValues extends Record<string, unknown> {
  name: string;
  approver: string;
  role: string;
  user_id: string;
  named: string;
  when: string;
  op: string;
  value: string;
  sla_hours: string;
}

/** A key for a new stage from its name: snake_case, unique in the flow. */
function keyFrom(name: string, taken: string[]): string {
  const base = (`stage_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.replace(/_+$/g, "").replace(/^stage__/, "stage_")).slice(0, 36);
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** The stage the form describes, in the contract's shape. */
function toStage(v: StageValues, context: Record<string, string>, base: ApprovalStageInput | null, taken: string[]): ApprovalStageInput {
  const type = context[v.when];
  const value = type === "money" ? toMoneyString(v.value) : type === "number" ? Number(v.value) : v.value.trim();
  const approver =
    v.approver === "role"
      ? { type: "role" as const, value: v.role }
      : v.approver === "user"
        ? { type: "user" as const, value: v.user_id }
        : v.approver === "employee_in_context"
          ? { type: "employee_in_context" as const, value: v.named }
          : { type: v.approver as "ceo" | "manager_of_subject" };
  return {
    key: base?.key ?? keyFrom(v.name, taken),
    name: v.name.trim(),
    approvers: [approver],
    condition: v.when ? [{ field: v.when, op: v.op as StageCondition["op"], value }, ...(base?.condition.slice(1) ?? [])] : [],
    sla_hours: Number(v.sla_hours),
    on_timeout: base?.on_timeout ?? "escalate",
    on_approve: base?.on_approve ?? "next",
    on_reject: base?.on_reject ?? "reject",
  };
}

/** The contract's ApprovalStageInput, checked against the form's fields. */
function stageRules(context: Record<string, string>, base: ApprovalStageInput | null, taken: string[]): ContractSchema {
  const fieldOf = (v: StageValues, path: PropertyKey[]) => {
    if (path[0] === "approvers") return v.approver === "role" ? "role" : v.approver === "user" ? "user_id" : v.approver === "employee_in_context" ? "named" : "approver";
    if (path[0] === "condition") return path[2] === "field" ? "when" : path[2] === "op" ? "op" : "value";
    return String(path[0] ?? "name");
  };
  return {
    safeParse(raw: unknown) {
      const v = raw as StageValues;
      const issues: Array<{ path: PropertyKey[]; message: string; code?: string }> = [];
      if (v.approver === "role" && !v.role) issues.push({ path: ["role"], message: "Pick a role" });
      if (v.approver === "user" && !v.user_id) issues.push({ path: ["user_id"], message: "Pick a person" });
      if (v.approver === "employee_in_context" && !v.named) issues.push({ path: ["named"], message: "Pick who" });
      if (v.when && !v.value.trim()) issues.push({ path: ["value"], message: "Enter a value" });
      const r = workflow.ApprovalStageInput.safeParse(toStage(v, context, base, taken));
      if (!r.success) for (const i of r.error.issues) issues.push({ path: [fieldOf(v, i.path)], message: i.message, code: i.code });
      return issues.length ? { success: false, error: { issues } } : { success: true, data: v };
    },
  };
}

/** One stage: its name, who approves it, when it applies, and how long it may wait. */
function StageForm({ flow, stage, label, taken, onCancel, onDone }: {
  flow: ApprovalFlow;
  stage: ApprovalStageInput | null;
  label: string;
  taken: string[];
  onCancel: () => void;
  onDone: (stage: ApprovalStageInput, label: string) => void;
}) {
  const roles = useInfinite("GET /api/v1/access/roles");
  // Only people who may still sign in and decide: never a Suspended or Left login.
  const users = usePaged("GET /api/v1/users", { filters: { status: "active" } });
  const first = stage?.approvers[0];
  const cond = stage?.condition[0];
  const [person, setPerson] = useState<UserRow[]>(first?.type === "user" && first.value ? [{ user_id: first.value, display_name: label } as UserRow] : []);
  const context = flow.context_types;
  const f = useContractForm<StageValues>(
    {
      name: stage?.name ?? "",
      approver: first?.type ?? "manager_of_subject",
      role: first?.type === "role" ? (first.value ?? "") : "",
      user_id: first?.type === "user" ? (first.value ?? "") : "",
      named: first?.type === "employee_in_context" ? (first.value ?? "") : "",
      when: cond?.field ?? "",
      op: cond?.op ?? ">",
      value: cond === undefined || Array.isArray(cond.value) ? "" : String(cond.value),
      sla_hours: String(stage?.sla_hours ?? 48),
    },
    stageRules(context, stage, taken),
  );
  const v = f.values;
  const type = context[v.when];
  const named = personFields(context);
  const kinds = named.length ? [...APPROVERS, NAMED] : APPROVERS;
  const done = () => {
    if (!f.check()) return;
    const next = toStage(v, context, stage, taken);
    const who =
      v.approver === "role" ? (roles.rows.find((r) => r.code === v.role)?.name ?? v.role) : v.approver === "user" ? (person[0]?.display_name ?? "") : (kinds.find(([k]) => k === v.approver)?.[1] ?? "");
    onDone(next, who);
  };

  return (
    <>
      <Field label="Stage Name" {...f.status("name")}>
        <TextField {...f.field("name")} />
      </Field>
      <Field label="Approver" {...f.status("approver")}>
        <ChoiceField options={kinds} {...f.field("approver")} />
      </Field>
      {v.approver === "employee_in_context" && (
        <Field label="Named In" {...f.status("named")}>
          <SelectField placeholder="Choose One" options={named.map((k) => [k, fieldLabel(k)] as [string, string])} {...f.field("named")} />
        </Field>
      )}
      {v.approver === "role" && (
        <Field label="Role" {...f.status("role")}>
          <SelectField placeholder="Choose One" options={roles.rows.map((r) => [r.code, r.name] as [string, string])} valueLabel={first?.type === "role" ? label : undefined} {...paging(roles)} {...f.field("role")} />
        </Field>
      )}
      {v.approver === "user" && (
        <Field label="Person" {...f.status("user_id")}>
          <RecordPicker
            list={users}
            value={person}
            onChange={(picked) => {
              setPerson(picked);
              f.field("user_id").onChange(picked[0]?.user_id ?? "");
            }}
            id={(u) => u.user_id}
            title={(u) => u.display_name}
            sub={(u) => u.job_title}
          />
        </Field>
      )}
      <Field label={<HelpTerm help={CONDITION_HELP}>Applies When</HelpTerm>} {...f.status("when")}>
        <SelectField options={[["", "Always"], ...Object.keys(context).map((k) => [k, fieldLabel(k)] as [string, string])]} {...f.field("when")} />
      </Field>
      {v.when && (
        <Inline gap={2}>
          <Field label="Comparison" {...f.status("op")}>
            <SelectField options={type === "money" || type === "number" || type === "date" ? OPS : OPS.filter(([k]) => k === "=")} {...f.field("op")} />
          </Field>
          <Field label={fieldLabel(v.when)} {...f.status("value")}>
            {type === "money" ? (
              <MoneyField {...f.field("value")} />
            ) : type === "number" ? (
              <NumberField decimal {...f.field("value")} />
            ) : type === "date" ? (
              <DateField {...f.field("value")} />
            ) : (
              <TextField {...f.field("value")} />
            )}
          </Field>
        </Inline>
      )}
      <Field label="Time Limit, Hours" {...f.status("sla_hours")}>
        <NumberField {...f.field("sla_hours")} />
      </Field>
      <FormFooter>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={done}>
          {stage ? "Update Stage" : "Add Stage"}
        </Button>
      </FormFooter>
    </>
  );
}
