/**
 * Performance · Goals, New Key Result and Edit Key Result (docs/guides/performance.md §3.2, §6.3, §10):
 * one form, checked by the goals contract (KeyResultCreate, or KeyResultEdit for a draft's key result).
 * Open: objective, key result, measure, target, target in words, TBC, unit, finish, owner, and Feeds for
 * a function's key result (the company key results it feeds, 25 a page from the server). Behind More:
 * Scored From for a company key result, co-owner, direction, baseline, start, type and owner note.
 * Set Target: a TBC target set in place before its lock date (§6.7).
 */
import { useState } from "react";
import goalsContract from "@mycity/contract/schemas/goals.js";
import type { Endpoints, KeyResultDetail, KeyResultRef, Objective } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { Button, CheckboxField, ChoiceField, DateField, EmptyState, Field, FormFooter, MoreFields, RecordPicker, SelectField, TextField, toast, useContractForm } from "@mycity/ui";
import { bodySchema } from "./shared";

export const KR_TYPES: Record<string, string> = {
  diagnostic_gate: "Diagnostic Gate",
  visibility_gate: "Visibility Gate",
  enabling: "Enabling",
  compliance_retiring: "Compliance, Retiring",
  compliance_floor: "Compliance, Floor",
  outcome: "Outcome",
  output: "Output",
};
const MEASURES: Array<[string, string]> = [["numeric", "Numeric"], ["dated", "Dated"], ["yes_no", "Yes or No"]];
/** The fields behind More: it opens itself while one of them is marked. */
const MORE = ["scored_from_key_result_id", "co_accountable_employee_id", "direction", "baseline_text", "starts_on", "kr_type", "accountable_note"];

type Values = {
  okr_objective_id: string;
  statement: string;
  measure: string;
  target_value: string;
  target_text: string;
  target_provisional: boolean;
  unit: string;
  finishes_on: string;
  accountable_employee_id: string;
  linked_company_key_result_ids: string[];
  scored_from_key_result_id: string;
  co_accountable_employee_id: string;
  direction: string;
  baseline_text: string;
  starts_on: string;
  kr_type: string;
  accountable_note: string;
};

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const refOf = (k: { okr_key_result_id: string; code: string; statement: string }): KeyResultRef => ({ okr_key_result_id: k.okr_key_result_id, code: k.code, statement: k.statement });

/** A quarter's key results to pick from: the company's (Feeds) or the functions' (Scored From). */
function KeyResultPicker({ periodId, level, value, onChange, multiple }: { periodId: string; level: "company" | "function"; value: KeyResultRef[]; onChange: (v: KeyResultRef[]) => void; multiple?: boolean }) {
  const list = usePaged("GET /api/v1/performance/key-results", { filters: { period_id: periodId, level } });
  return (
    <RecordPicker
      list={list}
      value={value}
      onChange={onChange}
      multiple={multiple}
      id={(k) => k.okr_key_result_id}
      title={(k) => k.code}
      sub={(k) => k.statement}
      placeholder="CO-KR1.2"
    />
  );
}

/**
 * New Key Result (`objectives`, the draft objectives the reader may add to) or Edit Key Result
 * (`keyResult`). `onSaved` is told once it is saved.
 */
export function KeyResultForm({ close, objectives = [], keyResult, onSaved }: { close: () => void; objectives?: Objective[]; keyResult?: KeyResultDetail; onSaved?: () => void }) {
  const k = keyResult;
  const f = useContractForm<Values>(
    {
      okr_objective_id: k?.okr_objective_id ?? objectives[0]?.okr_objective_id ?? "",
      statement: k?.statement ?? "",
      measure: k?.measure ?? "numeric",
      target_value: k?.target_value ?? "",
      target_text: k?.target_text ?? "",
      target_provisional: k?.target_provisional ?? false,
      unit: k?.unit ?? "",
      finishes_on: k?.finishes_on ?? "",
      accountable_employee_id: k?.accountable?.employee_id ?? "",
      linked_company_key_result_ids: k?.linked_company_key_results.map((c) => c.okr_key_result_id) ?? [],
      scored_from_key_result_id: k?.scored_from_key_result_id ?? "",
      co_accountable_employee_id: k?.co_accountable?.employee_id ?? "",
      direction: k?.direction ?? "higher",
      baseline_text: k?.baseline_text ?? "",
      starts_on: k?.starts_on ?? "",
      kr_type: k?.kr_type ?? "",
      accountable_note: k?.accountable_note ?? "",
    },
    k ? bodySchema<Values>(goalsContract.KeyResultEdit, (v) => editBody(v, k)) : bodySchema<Values>(goalsContract.KeyResultCreate, (v) => createBody(v, objectives)),
  );
  const v = f.values as Values;
  const objective = objectives.find((o) => o.okr_objective_id === v.okr_objective_id);
  const company = k ? k.department_id === null : objective?.department_id === null;
  const periodId = k ? k.performance_period_id : (objective?.performance_period_id ?? "");
  const [owner, setOwner] = useState<PersonRef[]>(k?.accountable ? [k.accountable] : []);
  const [coOwner, setCoOwner] = useState<PersonRef[]>(k?.co_accountable ? [k.co_accountable] : []);
  const [feeds, setFeeds] = useState<KeyResultRef[]>(k?.linked_company_key_results ?? []);
  const scoredFrom = useApi("GET /api/v1/performance/key-results/:id", { params: { id: k?.scored_from_key_result_id ?? "" }, enabled: Boolean(k?.scored_from_key_result_id) });
  const [scored, setScored] = useState<KeyResultRef[] | null>(null);
  const scoredShown = scored ?? (scoredFrom.data ? [refOf(scoredFrom.data)] : []);
  const create = useMutation("POST /api/v1/performance/key-results");
  const change = useMutation("PATCH /api/v1/performance/key-results/:id");

  const save = async () => {
    if (!f.check()) return;
    try {
      if (k) {
        await change.run({ params: { id: k.okr_key_result_id }, body: editBody(v, k) as Endpoints["PATCH /api/v1/performance/key-results/:id"]["body"] });
        toast("Key result saved");
      } else {
        const saved = await create.run({ body: createBody(v, objectives) as Endpoints["POST /api/v1/performance/key-results"]["body"] });
        toast(`${saved.code} set`);
      }
      invalidate("/api/v1/performance/okrs");
      invalidate("/api/v1/performance/key-results");
      close();
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };

  if (!k && !objectives.length) return <EmptyState bare title="No Objectives Yet" />;
  const moreMarked = MORE.some((key) => f.status(key as keyof Values).message);
  return (
    <>
      {!k && (
        <Field label="Objective" {...f.status("okr_objective_id")}>
          <SelectField options={objectives.map((o) => [o.okr_objective_id, `${o.code} · ${o.title}`] as [string, string])} {...f.field("okr_objective_id")} />
        </Field>
      )}
      <Field label="Key Result" {...f.status("statement")}><TextField {...f.field("statement")} /></Field>
      {k?.measure !== "multi_part" && (
        <Field label="Measure" {...f.status("measure")}>
          <ChoiceField label="Measure" options={MEASURES} value={v.measure} onChange={(x) => f.field("measure").onChange(x)} />
        </Field>
      )}
      <Field label="Target" optional {...f.status("target_value")}><TextField {...f.field("target_value")} inputMode="decimal" placeholder="64000" /></Field>
      <Field label="Target in Words" optional {...f.status("target_text")}><TextField {...f.field("target_text")} placeholder="64,000 users" /></Field>
      <Field label="TBC" {...f.status("target_provisional")}>
        <CheckboxField label="Target to be confirmed" value={v.target_provisional} onChange={(x) => f.field("target_provisional").onChange(x)} />
      </Field>
      <Field label="Unit" optional {...f.status("unit")}><TextField {...f.field("unit")} placeholder="users" /></Field>
      <Field label="Finish" optional {...f.status("finishes_on")}><DateField {...f.field("finishes_on")} /></Field>
      <Field label="Owner" optional {...f.status("accountable_employee_id")}>
        <EmployeePicker
          value={owner}
          onChange={(p) => {
            setOwner(p);
            f.field("accountable_employee_id").onChange(p[0]?.employee_id ?? "");
          }}
        />
      </Field>
      {!company && periodId && (
        <Field label="Feeds" optional {...f.status("linked_company_key_result_ids")}>
          <KeyResultPicker
            periodId={periodId}
            level="company"
            multiple
            value={feeds}
            onChange={(picked) => {
              setFeeds(picked);
              f.field("linked_company_key_result_ids").onChange(picked.map((x) => x.okr_key_result_id));
            }}
          />
        </Field>
      )}
      <MoreFields invalid={moreMarked}>
        {company && periodId && (
          <Field label="Scored From" optional {...f.status("scored_from_key_result_id")}>
            <KeyResultPicker
              periodId={periodId}
              level="function"
              value={scoredShown}
              onChange={(picked) => {
                const one = picked.slice(-1);
                setScored(one);
                f.field("scored_from_key_result_id").onChange(one[0]?.okr_key_result_id ?? "");
              }}
            />
          </Field>
        )}
        <Field label="Co-Owner" optional {...f.status("co_accountable_employee_id")}>
          <EmployeePicker
            value={coOwner}
            onChange={(p) => {
              setCoOwner(p);
              f.field("co_accountable_employee_id").onChange(p[0]?.employee_id ?? "");
            }}
          />
        </Field>
        <Field label="Direction" {...f.status("direction")}>
          <ChoiceField label="Direction" options={[["higher", "Higher Is Better"], ["lower", "Lower Is Better"]]} value={v.direction} onChange={(x) => f.field("direction").onChange(x)} />
        </Field>
        <Field label="Baseline" optional {...f.status("baseline_text")}><TextField {...f.field("baseline_text")} /></Field>
        <Field label="Start" optional {...f.status("starts_on")}><DateField {...f.field("starts_on")} /></Field>
        <Field label="Type" optional {...f.status("kr_type")}>
          <SelectField placeholder="None" options={[["", "None"], ...Object.entries(KR_TYPES)]} {...f.field("kr_type")} />
        </Field>
        <Field label="Owner Note" optional {...f.status("accountable_note")}><TextField {...f.field("accountable_note")} /></Field>
      </MoreFields>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>{k ? "Save Key Result" : "Set Key Result"}</Button>
      </FormFooter>
    </>
  );
}

/** The form as KeyResultCreate: a company key result feeds nothing; only a company key result is Scored From. */
function createBody(v: Values, objectives: Objective[]) {
  const company = objectives.find((o) => o.okr_objective_id === v.okr_objective_id)?.department_id === null;
  return {
    ...v,
    linked_company_key_result_ids: company ? [] : v.linked_company_key_result_ids,
    scored_from_key_result_id: company ? v.scored_from_key_result_id : "",
  };
}

/** The form as KeyResultEdit: every field the form shows (an empty one clears it); a multi-part key result keeps its measure and parts. */
function editBody(v: Values, k: KeyResultDetail) {
  const { okr_objective_id: _objective, measure, ...rest } = v;
  const company = k.department_id === null;
  return {
    ...rest,
    ...(k.measure === "multi_part" ? {} : { measure }),
    linked_company_key_result_ids: company ? [] : v.linked_company_key_result_ids,
    scored_from_key_result_id: company ? v.scored_from_key_result_id : "",
  };
}

/** Set Target: a TBC target set in place by its owner or the function's head before the lock date; it stays TBC until then. */
export function SetTargetForm({ keyResult, close, onSaved }: { keyResult: KeyResultDetail; close: () => void; onSaved?: () => void }) {
  type Target = { target_value: string; target_text: string };
  const f = useContractForm<Target>({ target_value: keyResult.target_value ?? "", target_text: keyResult.target_text ?? "" }, goalsContract.KeyResultEdit);
  const save = useMutation("PATCH /api/v1/performance/key-results/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: keyResult.okr_key_result_id }, body: f.values as Endpoints["PATCH /api/v1/performance/key-results/:id"]["body"] });
      invalidate("/api/v1/performance/okrs");
      close();
      toast("Target set");
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Target" optional {...f.status("target_value")}><TextField {...f.field("target_value")} inputMode="decimal" placeholder="64000" /></Field>
      <Field label="Target in Words" optional {...f.status("target_text")}><TextField {...f.field("target_text")} placeholder="64,000 users" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set Target</Button>
      </FormFooter>
    </>
  );
}
