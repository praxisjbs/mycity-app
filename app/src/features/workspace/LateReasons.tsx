/**
 * Late Reasons (docs/guides/workspace.md §6 Late reasons, §10.1): Why Late's reasons, behind the
 * settings icon on Tasks for holders of `workspace.late_reasons`. One press switches a reason off or
 * on; Add Reason puts a new one at the foot. A reason is never deleted, so answers keep it.
 */
import { useState } from "react";
import tasks from "@mycity/contract/schemas/tasks.js";
import type { LateReasonOption } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useInfinite } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { hasCapability } from "@/shell/access";
import { Button, ErrorState, Field, FormFooter, LoadingRows, TextField, toast, ToggleRow, useContractForm } from "@mycity/ui";
import { say } from "./shared";

/** Does the reader keep Why Late's reasons? The CEO holds every capability. */
export function useKeepsReasons(): boolean {
  return hasCapability(useMe(), "workspace.late_reasons");
}

/** The reasons Why Late offers: those switched on, in their order (up to 25, one page). */
export function useLateReasons() {
  return useInfinite("GET /api/v1/tasks/late-reasons", {});
}

export function LateReasons({ close }: { close: () => void }) {
  const list = useInfinite("GET /api/v1/tasks/late-reasons", { filters: { all: "true" } });
  const [switching, setSwitching] = useState<string | null>(null);
  const f = useContractForm({ label: "" }, tasks.LateReasonCreate);

  const flip = async (r: LateReasonOption, on: boolean) => {
    setSwitching(r.task_late_reason_id);
    try {
      await api.call("PATCH /api/v1/tasks/late-reasons/:id", { params: { id: r.task_late_reason_id }, body: { active: on } });
      invalidate("/api/v1/tasks/late-reasons");
      toast(on ? `${r.label} switched on` : `${r.label} switched off`);
    } catch (e) {
      say(e);
    } finally {
      setSwitching(null);
    }
  };

  const add = async () => {
    if (!f.check()) return;
    try {
      const made = await api.call("POST /api/v1/tasks/late-reasons", { body: f.values });
      invalidate("/api/v1/tasks/late-reasons");
      f.reset({ label: "" });
      toast(`${made.label} added`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };

  return (
    <>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.rows.length ? (
        <LoadingRows count={6} />
      ) : (
        <div>
          {list.rows.map((r) => (
            <ToggleRow
              key={r.task_late_reason_id}
              title={r.label}
              checked={r.active}
              disabled={switching !== null}
              onChange={(on) => void flip(r, on)}
            />
          ))}
        </div>
      )}
      <Field label="Reason" {...f.field("label")}>
        <TextField {...f.field("label")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        <Button variant="primary" icon="plus" onClick={add}>Add Reason</Button>
      </FormFooter>
    </>
  );
}
