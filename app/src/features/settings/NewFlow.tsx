import { useState } from "react";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { ApprovalFlowCreate } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import {
  Button,
  Card,
  CardHeader,
  Field,
  FormFooter,
  IconButton,
  Inline,
  Pill,
  SelectField,
  Stack,
  TextField,
  toast,
  useContractForm,
  Wizard,
  type ContractSchema,
} from "@mycity/ui";
import { fieldLabel, StageCards, StageDraftForm, useStageDraft } from "./Stages";

/**
 * New Flow (docs/guides/foundation.md §6.5, §10): a flow nobody has coded yet, made in
 * three steps. Flow names it and says which module its requests are about; Values are
 * what a stage may compare (an amount, a number of days); Stages are who decides, in
 * order, built as Edit Stages builds them. Create Flow saves it as version 1.
 */
const MODULE_HELP = "The people a stage names also need Approve access to this module to decide.";
const VALUES_HELP = "What a stage may compare, such as an amount or a number of days. Fixed once the flow is made.";

type ValueType = ApprovalFlowCreate["context_types"][string];

const TYPES: Array<[ValueType, string]> = [["money", "Money"], ["number", "Number"], ["date", "Date"], ["text", "Text"], ["boolean", "Yes or No"], ["uuid", "Person"]];
const typeName = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

/** The most values a flow carries (the contract's ApprovalFlowCreate). */
const MAX_VALUES = 5;

interface FlowValues extends Record<string, unknown> {
  name: string;
  module_key: string;
  description: string;
}

interface ValueDraft {
  key: string;
  type: ValueType;
}

/** A value's key from its name: snake_case, starting with a letter, at most 40. Empty when the name has none to give. */
function valueKey(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return (/^[a-z]/.test(slug) ? slug : `value_${slug}`).slice(0, 40).replace(/_+$/, "");
}

/** The contract's name and description, checked against the Flow step's fields. */
const flowRules: ContractSchema = {
  safeParse(raw: unknown) {
    const v = raw as FlowValues;
    const shape = workflow.ApprovalFlowCreate.shape;
    const issues: Array<{ path: PropertyKey[]; message: string; code?: string }> = [];
    if (!v.name.trim()) issues.push({ path: ["name"], message: "Required" });
    else {
      const r = shape.name.safeParse(v.name);
      if (!r.success) for (const i of r.error.issues) issues.push({ path: ["name"], message: i.message, code: i.code });
    }
    if (!v.module_key) issues.push({ path: ["module_key"], message: "Pick a module" });
    const d = shape.description.safeParse(v.description);
    if (!d.success) for (const i of d.error.issues) issues.push({ path: ["description"], message: i.message, code: i.code });
    return issues.length ? { success: false, error: { issues } } : { success: true, data: v };
  },
};

/** Does a stage read this value, in a condition or as the person it names? */
const readsValue = (stages: ApprovalFlowCreate["stages"], key: string) =>
  stages.some((s) => s.condition.some((c) => c.field === key) || s.approvers.some((a) => a.type === "employee_in_context" && a.value === key));

export function NewFlow({ close }: { close: () => void }) {
  const cat = useApi("GET /api/v1/settings/roles/catalogue");
  const create = useMutation("POST /api/v1/settings/approvals");
  const f = useContractForm<FlowValues>({ name: "", module_key: "", description: "" }, flowRules);
  const [values, setValues] = useState<ValueDraft[]>([]);
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [noStage, setNoStage] = useState(false);
  const draft = useStageDraft([]);
  const context = Object.fromEntries(values.map((x) => [x.key, x.type]));

  if (adding) {
    return (
      <ValueForm
        taken={values.map((x) => x.key)}
        onCancel={() => setAdding(false)}
        onDone={(value) => {
          setValues((all) => [...all, value]);
          setAdding(false);
        }}
      />
    );
  }
  if (draft.editing !== null) return <StageDraftForm draft={draft} context={context} />;

  const finish = async () => {
    setProblem(null);
    const v = f.values;
    const description = v.description.trim();
    const body: ApprovalFlowCreate = {
      name: v.name.trim(),
      module_key: v.module_key,
      ...(description ? { description } : {}),
      context_types: Object.fromEntries(values.map((x) => [x.key, x.type])),
      stages: draft.stages,
    };
    try {
      await create.run({ body });
      invalidate("/api/v1/settings/approvals");
      close();
      toast("Flow created");
    } catch (e) {
      if (!(e instanceof ApiError)) return setProblem("Not saved. Try again.");
      f.setServerErrors(e.fields);
      // A refusal of the name or the module takes the person back to the step that holds it.
      const onFlow = Boolean(e.fields.name || e.fields.module_key || e.fields.description);
      if (onFlow) setStep(0);
      setProblem(e.fields.stages?.join(" · ") ?? (onFlow ? null : e.message));
    }
  };

  return (
    <Wizard
      step={step}
      onStepChange={setStep}
      finish="Create Flow"
      onFinish={finish}
      onCancel={close}
      error={problem ?? (noStage && !draft.stages.length ? "Add a stage" : null)}
      steps={[
        {
          title: "Flow",
          check: () => f.check(),
          body: (
            <>
              <Field label="Flow Name" {...f.status("name")}>
                <TextField {...f.field("name")} placeholder="Petty Cash" maxLength={60} />
              </Field>
              <Field label="Module" help={MODULE_HELP} {...f.status("module_key")}>
                <SelectField
                  searchable
                  placeholder="Choose One"
                  options={(cat.data?.modules ?? []).map((m) => [m.key, m.label] as [string, string])}
                  {...f.field("module_key")}
                />
              </Field>
              <Field label="Description" optional {...f.status("description")}>
                <TextField {...f.field("description")} maxLength={200} />
              </Field>
            </>
          ),
        },
        {
          title: "Values",
          body: (
            <Field label="Values" optional help={VALUES_HELP}>
              <Stack gap={2}>
                {values.map((x) => {
                  const used = readsValue(draft.stages, x.key);
                  return (
                    <Card key={x.key}>
                      <CardHeader
                        title={fieldLabel(x.key)}
                        record
                        level={3}
                        actions={
                          <Inline gap={2}>
                            <Pill>{typeName(x.type)}</Pill>
                            <IconButton
                              icon="trash"
                              size="sm"
                              label={used ? `Remove ${fieldLabel(x.key)}, a stage reads it` : `Remove ${fieldLabel(x.key)}`}
                              disabled={used}
                              onClick={() => setValues((all) => all.filter((y) => y.key !== x.key))}
                            />
                          </Inline>
                        }
                      />
                    </Card>
                  );
                })}
                <div>
                  {values.length < MAX_VALUES ? (
                    <Button icon="plus" onClick={() => setAdding(true)}>
                      Add Value
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">{`At most ${MAX_VALUES} values`}</p>
                  )}
                </div>
              </Stack>
            </Field>
          ),
        },
        {
          title: "Stages",
          check: () => {
            setNoStage(!draft.stages.length);
            return draft.stages.length > 0;
          },
          body: <StageCards draft={draft} context={context} />,
        },
      ]}
    />
  );
}

/** One value: its name, which becomes its key, and its type. */
function ValueForm({ taken, onCancel, onDone }: { taken: string[]; onCancel: () => void; onDone: (value: ValueDraft) => void }) {
  const f = useContractForm(
    { name: "", type: "" },
    {
      name: (v) => {
        const text = String(v ?? "").trim();
        if (!text) return "Required";
        if (text.length > 40) return "At most 40 characters";
        const key = valueKey(text);
        return !key ? "Use letters" : taken.includes(key) ? "Name already used" : null;
      },
      type: (v) => (v ? null : "Pick a type"),
    },
  );
  const done = () => {
    if (!f.check()) return;
    onDone({ key: valueKey(f.values.name.trim()), type: f.values.type as ValueType });
  };
  return (
    <>
      <Field label="Value Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Amount" maxLength={40} />
      </Field>
      <Field label="Type" {...f.status("type")}>
        <SelectField placeholder="Choose One" options={TYPES} {...f.field("type")} />
      </Field>
      <FormFooter>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={done}>
          Add Value
        </Button>
      </FormFooter>
    </>
  );
}
