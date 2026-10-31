import { useState } from "react";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { ApprovalStage, ApprovalStageInput, StageCondition, UserRow } from "@mycity/contract/contract.gen.ts";
import { useInfinite, usePaged } from "@/api/hooks";
import { paging } from "@/features/shared/wire";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DateField,
  Field,
  FormFooter,
  formatMoney,
  HelpTerm,
  IconButton,
  Inline,
  KeyValue,
  MoneyField,
  NumberField,
  RecordPicker,
  SelectField,
  Stack,
  TextField,
  toMoneyString,
  useContractForm,
  type ContractSchema,
} from "@mycity/ui";

/**
 * The stages of an approval flow, drawn once for Edit Stages and for New Flow
 * (docs/guides/foundation.md §6.5): the draft a person builds one stage at a time,
 * its cards (Move Up, Move Down, Edit, Remove, Add Stage) and the form of one stage
 * (approver, when it applies, its time limit). No drag and drop: stages move with
 * Move Up and Move Down.
 */
export const CONDITION_HELP = "A stage runs only for requests that match. Others skip it and go to the next stage.";

const OPS: Array<[string, string]> = [[">", "Over"], [">=", "At Least"], ["<", "Under"], ["<=", "At Most"], ["=", "Exactly"]];
const OP_WORD: Record<string, string> = { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "is", in: "is one of" };
const APPROVERS: Array<[string, string]> = [["manager_of_subject", "Line Manager"], ["role", "Role"], ["user", "Person"], ["ceo", "CEO"]];
const NAMED: [string, string] = ["employee_in_context", "Named Person"];
/** The types a comparison may be Over, At Least, Under or At Most. */
const ORDERED = new Set(["money", "number", "date"]);
const YES_NO: Array<[string, string]> = [["true", "Yes"], ["false", "No"]];

/** The flow's fields that name a person: a named-person stage reads one of them. */
const personFields = (context: Record<string, string>) => Object.keys(context).filter((k) => context[k] === "uuid");

/** The fields a stage's condition may compare: a person's id is a name to read, never a number to compare. */
const comparable = (context: Record<string, string>) => Object.keys(context).filter((k) => context[k] !== "uuid");

export const fieldLabel = (key: string) => key.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
export const hours = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);
/** The most stages a flow takes (the contract's ApprovalStepsUpdate). */
export const MAX_STAGES = 10;

function valueText(c: StageCondition, type: string | undefined): string {
  const one = (v: string | number | boolean) => (type === "money" ? formatMoney(String(v)) : type === "boolean" ? (v === true || v === "true" ? "Yes" : "No") : String(v));
  return Array.isArray(c.value) ? c.value.map(one).join(", ") : one(c.value);
}

/** "Days over 5", or Always for a stage with no condition. */
export function conditionText(stage: { condition: StageCondition[] }, context: Record<string, string>): string {
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

/** The stages a person is building: each as the contract takes it, and who decides it as a person reads it. */
export interface StageDraft {
  stages: ApprovalStageInput[];
  labels: string[];
  /** The stage open in its form: its place, "new", or none. */
  editing: number | "new" | null;
  setEditing: (at: number | "new" | null) => void;
  move: (i: number, d: number) => void;
  remove: (i: number) => void;
  /** The form's answer: the stage replaces the one being edited, or is added. */
  accept: (stage: ApprovalStageInput, label: string) => void;
}

export function useStageDraft(initial: ApprovalStage[]): StageDraft {
  const [stages, setStages] = useState<ApprovalStageInput[]>(() => initial.map(asInput));
  const [labels, setLabels] = useState<string[]>(() => initial.map((x) => x.approvers.map((a) => a.label).join(", ")));
  const [editing, setEditing] = useState<number | "new" | null>(null);
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
  const accept = (stage: ApprovalStageInput, label: string) => {
    const at = editing === "new" ? null : editing;
    setStages((all) => (at === null ? [...all, stage] : all.map((x, i) => (i === at ? stage : x))));
    setLabels((all) => (at === null ? [...all, label] : all.map((x, i) => (i === at ? label : x))));
    setEditing(null);
  };
  return { stages, labels, editing, setEditing, move, remove, accept };
}

/** The stages one under another, each with its moves, and Add Stage under them. */
export function StageCards({ draft, context }: { draft: StageDraft; context: Record<string, string> }) {
  const { stages, labels } = draft;
  return (
    <Stack gap={2}>
      {stages.map((stage, i) => (
        <Card key={stage.key}>
          <CardHeader
            title={`${i + 1}. ${stage.name}`}
            record
            level={3}
            actions={
              <Inline gap={1}>
                <IconButton icon="up" size="sm" label={`Move ${stage.name} Up`} disabled={i === 0} onClick={() => draft.move(i, -1)} />
                <IconButton icon="down" size="sm" label={`Move ${stage.name} Down`} disabled={i === stages.length - 1} onClick={() => draft.move(i, 1)} />
                <IconButton icon="edit" size="sm" label={`Edit ${stage.name}`} onClick={() => draft.setEditing(i)} />
                <IconButton icon="trash" size="sm" label={`Remove ${stage.name}`} disabled={stages.length === 1} onClick={() => draft.remove(i)} />
              </Inline>
            }
          />
          <KeyValue
            items={[
              ["Approver", labels[i]],
              [<HelpTerm key="when" help={CONDITION_HELP}>Applies When</HelpTerm>, conditionText(stage, context)],
              ["Time Limit", hours(stage.sla_hours)],
            ]}
          />
        </Card>
      ))}
      <div>
        {stages.length < MAX_STAGES ? (
          <Button icon="plus" onClick={() => draft.setEditing("new")}>
            Add Stage
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{`At most ${MAX_STAGES} stages`}</p>
        )}
      </div>
    </Stack>
  );
}

/** The stage the draft has open, in its form. */
export function StageDraftForm({ draft, context }: { draft: StageDraft; context: Record<string, string> }) {
  const at = draft.editing === "new" || draft.editing === null ? null : draft.editing;
  return (
    <StageForm
      context={context}
      stage={at === null ? null : draft.stages[at]}
      label={at === null ? "" : draft.labels[at]}
      taken={draft.stages.filter((_, i) => i !== at).map((x) => x.key)}
      onCancel={() => draft.setEditing(null)}
      onDone={draft.accept}
    />
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
  const value = type === "money" ? toMoneyString(v.value) : type === "number" ? Number(v.value) : type === "boolean" ? v.value !== "false" : v.value.trim();
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
      if (v.when && context[v.when] !== "boolean" && !v.value.trim()) issues.push({ path: ["value"], message: "Enter a value" });
      const r = workflow.ApprovalStageInput.safeParse(toStage(v, context, base, taken));
      if (!r.success) for (const i of r.error.issues) issues.push({ path: [fieldOf(v, i.path)], message: i.message, code: i.code });
      return issues.length ? { success: false, error: { issues } } : { success: true, data: v };
    },
  };
}

/** One stage: its name, who approves it, when it applies, and how long it may wait. */
function StageForm({ context, stage, label, taken, onCancel, onDone }: {
  context: Record<string, string>;
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
  /** A different value to compare: start its comparison and number again, so none carries over from another type. */
  const pickWhen = (when: string) => {
    f.set("when", when);
    f.set("op", ORDERED.has(context[when]) ? ">" : "=");
    f.set("value", "");
  };
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
        <SelectField options={[["", "Always"], ...comparable(context).map((k) => [k, fieldLabel(k)] as [string, string])]} {...f.field("when")} onChange={pickWhen} />
      </Field>
      {v.when && (
        <Inline gap={2}>
          <Field label="Comparison" {...f.status("op")}>
            <SelectField options={ORDERED.has(type) ? OPS : OPS.filter(([k]) => k === "=")} {...f.field("op")} />
          </Field>
          <Field label={fieldLabel(v.when)} {...f.status("value")}>
            {type === "money" ? (
              <MoneyField {...f.field("value")} />
            ) : type === "number" ? (
              <NumberField decimal {...f.field("value")} />
            ) : type === "date" ? (
              <DateField {...f.field("value")} />
            ) : type === "boolean" ? (
              <ChoiceField options={YES_NO} {...f.field("value")} value={v.value || "true"} />
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
