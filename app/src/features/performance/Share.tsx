/**
 * Share Goal and Share Objective (docs/guides/performance.md §3.1, §6.24, §10): who an organisational goal or a
 * company objective is shared with. The CEO shares a goal and Management an objective, with all staff or
 * chosen departments, read only; Stop Sharing takes it back. The same form serves both, over the contract's
 * GoalShareSave.
 */
import { useState } from "react";
import goalsContract from "@mycity/contract/schemas/goals.js";
import type { GoalShare, PerformanceDepartment } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import { Button, ChoiceField, Field, FormError, FormFooter, RecordPicker, toast, useContractForm } from "@mycity/ui";

export type ShareKind = "goal" | "objective";

/** How an item is shared, in a few words: what the Shared column and the sheets read. */
export function shareLabel(share: GoalShare | null | undefined): string {
  if (!share) return "Not Shared";
  if (share.audience === "all") return "All Staff";
  const names = share.departments.map((d) => d.name);
  return names.length > 2 ? `${names.length} Departments` : names.join(", ");
}

/** The toast after a share is saved: "Goal shared with all staff", "Objective shared with 2 departments". */
function sharedToast(kind: ShareKind, share: GoalShare): string {
  const what = kind === "goal" ? "Goal" : "Objective";
  if (share.audience === "all") return `${what} shared with all staff`;
  const n = share.departments.length;
  return `${what} shared with ${n} ${n === 1 ? "department" : "departments"}`;
}

/** The departments a share may reach: the reader's own choices, searched on the server, 25 at a time. */
function DepartmentsPicker({ value, onChange }: { value: PerformanceDepartment[]; onChange: (value: PerformanceDepartment[]) => void }) {
  const list = usePaged("GET /api/v1/performance/departments");
  return (
    <RecordPicker
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      value={value}
      onChange={onChange}
      id={(d) => d.department_id}
      title={(d) => d.name}
      sub={(d) => d.code}
      multiple
      placeholder="Search departments"
    />
  );
}

type Values = { audience: "all" | "departments"; department_ids: string[] };

/**
 * The form: Share With (All Staff or Chosen Departments), Departments for the second, Share Goal or Share
 * Objective to save, and Stop Sharing while it is shared.
 * @param share  how the item is shared now, null when it is not
 */
export function ShareForm({ kind, id, share, close }: { kind: ShareKind; id: string; share: GoalShare | null; close: () => void }) {
  const noun = kind === "goal" ? "Goal" : "Objective";
  const [picked, setPicked] = useState<PerformanceDepartment[]>(share?.audience === "departments" ? share.departments : []);
  const f = useContractForm<Values>(
    { audience: share?.audience ?? "all", department_ids: share?.audience === "departments" ? share.departments.map((d) => d.department_id) : [] },
    goalsContract.GoalShareSave,
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const saveGoal = useMutation("PUT /api/v1/performance/goals/:id/share");
  const saveObjective = useMutation("PUT /api/v1/performance/objectives/:id/share");
  const stopGoal = useMutation("DELETE /api/v1/performance/goals/:id/share");
  const stopObjective = useMutation("DELETE /api/v1/performance/objectives/:id/share");
  const audience = f.values.audience;
  const changed = () => {
    invalidate("/api/v1/performance/goals");
    invalidate("/api/v1/performance/objectives");
    invalidate("/api/v1/performance/okrs");
  };
  const say = (e: unknown) => {
    if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
    else setRefusal(e instanceof ApiError ? e.message : "Could not save");
  };
  const pick = (rows: PerformanceDepartment[]) => {
    setPicked(rows);
    f.field("department_ids").onChange(rows.map((d) => d.department_id));
  };
  const save = async () => {
    setRefusal(null);
    if (!f.check()) return;
    const body: Values = { audience, department_ids: audience === "departments" ? f.values.department_ids : [] };
    try {
      const saved = kind === "goal" ? await saveGoal.run({ params: { id }, body }) : await saveObjective.run({ params: { id }, body });
      changed();
      close();
      toast(sharedToast(kind, saved as GoalShare));
    } catch (e) {
      say(e);
    }
  };
  const stop = async () => {
    setRefusal(null);
    try {
      if (kind === "goal") await stopGoal.run({ params: { id } });
      else await stopObjective.run({ params: { id } });
      changed();
      close();
      toast(`${noun} is no longer shared`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Share With" help="People you choose read it and cannot change it." {...f.status("audience")}>
        <ChoiceField
          value={audience}
          onChange={(v) => {
            f.field("audience").onChange(v as Values["audience"]);
            if (v === "all") pick([]);
          }}
          options={[["all", "All Staff"], ["departments", "Chosen Departments"]]}
        />
      </Field>
      {audience === "departments" && (
        <Field label="Departments" {...f.status("department_ids")}>
          <DepartmentsPicker value={picked} onChange={pick} />
        </Field>
      )}
      {refusal && <FormError>{refusal}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {share && <Button onClick={stop}>Stop Sharing</Button>}
        <Button variant="primary" onClick={save}>{`Share ${noun}`}</Button>
      </FormFooter>
    </>
  );
}
