import { useState } from "react";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { ManagerRef } from "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { Button, Field, FormFooter, SelectField, TextField, toast } from "@mycity/ui";

/** Whose line it is and who is above them now, as the employee 360 and the org chart both hold it. */
export type ReportingSubject = {
  employee_id: string;
  display_name: string;
  line_manager: ManagerRef | null;
  dotted_manager: ManagerRef | null;
};

/**
 * Change who someone reports to: a person, or the seat above them when it is open. The
 * employee record's Change Manager and a person's sheet on the organogram open this one form,
 * and it makes the same write a drag on the chart does (docs/guides/organogram.md §3, §5).
 */
export function ReportingForm({ employee: e, close, onSaved }: { employee: ReportingSubject; close: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"person" | "seat">(e.line_manager?.vacant ? "seat" : "person");
  const [manager, setManager] = useState<PersonRef[]>(
    e.line_manager && e.line_manager.employee_id
      ? [{ employee_id: e.line_manager.employee_id, display_name: e.line_manager.display_name, job_title: e.line_manager.job_title, department: null }]
      : [],
  );
  const [dotted, setDotted] = useState<PersonRef[]>(
    e.dotted_manager && e.dotted_manager.employee_id
      ? [{ employee_id: e.dotted_manager.employee_id, display_name: e.dotted_manager.display_name, job_title: e.dotted_manager.job_title, department: null }]
      : [],
  );
  const seats = usePaged("GET /api/v1/org-seats", { filters: { status: "vacant" } });
  const [seat, setSeat] = useState<string>(e.line_manager?.org_seat_id ?? "");
  const [reason, setReason] = useState("");
  const save = useMutation("PATCH /api/v1/employees/:id/line-manager");

  const submit = async () => {
    const body =
      kind === "seat"
        ? { line_manager_seat_id: seat || null, dotted_manager_id: dotted[0]?.employee_id ?? null, reason: reason.trim() }
        : { line_manager_id: manager[0]?.employee_id ?? null, dotted_manager_id: dotted[0]?.employee_id ?? null, reason: reason.trim() };
    try {
      await save.run({ params: { id: e.employee_id }, body });
      invalidate("/api/v1/employees", "/api/v1/org-chart");
      onSaved();
      close();
      toast(`${e.display_name} reassigned`);
    } catch {
      toast(save.error?.message ?? "Not changed");
    }
  };

  return (
    <>
      <Field label="Manager Is">
        <SelectField
          value={kind}
          onChange={(v) => setKind(v as "person" | "seat")}
          options={[
            ["person", "A Person"],
            ["seat", "An Open Role"],
          ]}
        />
      </Field>
      {kind === "person" ? (
        <Field label="Line Manager">
          <EmployeePicker value={manager} onChange={setManager} placeholder="Manager's name" />
        </Field>
      ) : (
        <Field label="Open Role">
          <SelectField
            value={seat}
            onChange={setSeat}
            placeholder="Open role"
            options={seats.rows.map((s) => [s.org_seat_id, `${s.title} · ${s.department}`] as [string, string])}
          />
        </Field>
      )}
      <Field label="Dotted Line" optional>
        <EmployeePicker value={dotted} onChange={setDotted} placeholder="Second manager" />
      </Field>
      <Field label="Reason" optional>
        <TextField value={reason} onChange={setReason} placeholder="New structure" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          Save Line
        </Button>
      </FormFooter>
    </>
  );
}
