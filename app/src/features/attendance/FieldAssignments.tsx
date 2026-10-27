import attendance from "@mycity/contract/schemas/attendance.js";
import type { FieldAssignment, FieldAssignmentState } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useViewNews, withNews } from "@/features/notifications/marks";
import type { PersonRef } from "@/api/types/common";
import { Button, Card, CardHeader, Chips, DataView, Field, formatDate, formatDateTime, FormFooter, HelpTerm, KeyValue, Pill, TextAreaField, toast, useContractForm, useModal, Who } from "@mycity/ui";
import { ASSIGNMENT_STATE } from "./labels";

/**
 * Field assignments made before PR 4 (docs/guides/attendance.md §6.12, §10), which retired making
 * new ones: People · Worksites' Temporary, Field view, where a line manager or People cancel one or
 * take someone off; and on My Attendance, the person's own in progress and to come. The API decides
 * who may change one; `can_change` says whether this reader may.
 */

export const assignmentPill = (a: Pick<FieldAssignment, "state">) => <Pill tone={ASSIGNMENT_STATE[a.state].tone}>{ASSIGNMENT_STATE[a.state].text}</Pill>;
const datesOf = (a: Pick<FieldAssignment, "starts_on" | "ends_on">) =>
  a.starts_on === a.ends_on ? formatDate(a.starts_on) : `${formatDate(a.starts_on)} to ${formatDate(a.ends_on)}`;
const peopleOf = (a: FieldAssignment) => {
  const on = a.members.filter((m) => !m.removed_at).map((m) => m.employee.display_name);
  return on.length <= 2 ? on.join(", ") : `${on.slice(0, 2).join(", ")} and ${on.length - 2} more`;
};

const STATE_CHIPS: Array<[FieldAssignmentState | "all", string]> = [
  ["all", "All"],
  ["in_progress", "In Progress"],
  ["upcoming", "Upcoming"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
];

/** People · Attendance, Field: the assignments with anyone in the reader's scope on them. */
export function FieldView({ openAssignment }: { openAssignment: (a: FieldAssignment) => void }) {
  const [state, setState] = useState<FieldAssignmentState | "all">("all");
  const list = usePaged("GET /api/v1/attendance/field-assignments", { filters: state === "all" ? {} : { state } });
  const news = useViewNews();
  return (
    <>
      <Chips label="Field Assignments" value={state} onChange={setState} options={withNews(news, STATE_CHIPS, { at: "temporary/field", all: "all" })} />
      <DataView
        title="Field Assignments"
        list={list}
        search="Name, Client or Person"
        rowKey={(a) => a.field_assignment_id}
        onRowClick={openAssignment}
        noun="assignment"
        empty={{ icon: "target", title: "No Assignments Here", text: "Choose All to see every assignment." }}
        columns={[
          { key: "n", label: "Assignment", render: (a) => `${a.number} · ${a.name}` },
          { key: "c", label: "Client", desktop: true, render: (a) => a.client },
          { key: "p", label: "People", render: peopleOf },
          { key: "starts_on", label: "Dates", sortable: true, render: datesOf },
          { key: "x", label: "Sites", desktop: true, render: (a) => a.sites.map((x) => x.name).join(", ") },
          { key: "s", label: "State", render: assignmentPill },
        ]}
      />
    </>
  );
}

/** A link to an assignment (`?assignment=`, from a notice or search) opens it, once. */
export function useAssignmentLink(id: string | null, open: (a: FieldAssignment) => void, { mine = false, before }: { mine?: boolean; before?: () => void } = {}) {
  const people = useApi("GET /api/v1/attendance/field-assignments/:id", { params: { id: id ?? "" }, enabled: !!id && !mine });
  const own = useApi("GET /api/v1/attendance/me/field-assignments/:id", { params: { id: id ?? "" }, enabled: !!id && mine });
  const data = mine ? own.data : people.data;
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (data && done.current !== data.field_assignment_id) {
      done.current = data.field_assignment_id;
      before?.();
      open(data);
    }
  }, [data, open, before]);
}

/** One assignment: what it is, its sites and its people; Take Off and Cancel Assignment when the reader may. */
export function AssignmentView({ a, close }: { a: FieldAssignment; close: () => void }) {
  const modal = useModal();
  const takeOff = (employee: PersonRef) =>
    modal.open({ title: `Take Off ${employee.display_name}`, body: (done) => <ChangeForm a={a} employee={employee} close={() => (done(), close())} /> });
  const cancel = () => modal.open({ title: "Cancel Assignment", body: (done) => <ChangeForm a={a} close={() => (done(), close())} /> });
  const active = a.members.filter((m) => !m.removed_at);
  return (
    <>
      <Card>
        <CardHeader record title={a.name} right={assignmentPill(a)} />
        <KeyValue
          items={[
            ["Number", a.number],
            ["Client", a.client],
            ["First Day", formatDate(a.starts_on)],
            ["Last Day", formatDate(a.ends_on)],
            ["Days", String(a.days)],
            ...(a.note ? ([["Note", a.note]] as Array<[string, string]>) : []),
            ["Set By", a.assigned_by_name],
            ["Set On", formatDateTime(a.assigned_at)],
            ...(a.cancelled_at
              ? ([
                  ["Cancelled", formatDateTime(a.cancelled_at)],
                  ["Reason", a.cancel_reason],
                ] as Array<[string, string | null]>)
              : []),
          ]}
        />
      </Card>
      <Card className="mt-3">
        <CardHeader title={a.sites.length === 1 ? "Site" : "Sites"} />
        {a.sites.map((x) => (
          <div key={x.field_site_id} className="border-b border-border py-2 last:border-b-0">
            <KeyValue
              items={[
                ["Site", x.name],
                ["Address", x.address],
                ["Centre", `${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}`],
                [<HelpTerm key="r" help="A punch within this distance of the site counts at the site.">Radius</HelpTerm>, `${x.radius_m} m`],
              ]}
            />
          </div>
        ))}
      </Card>
      <DataView
        className="mt-3"
        title="People"
        rows={a.members}
        rowKey={(m) => m.employee.employee_id}
        help={a.can_change && active.length === 1 ? "The last person stays on it. Cancel Assignment ends it instead." : undefined}
        noun="person"
        nounPlural="people"
        columns={[
          { key: "e", label: "Employee", render: (m) => <Who name={m.employee.display_name} sub={m.employee.department} /> },
          { key: "s", label: "On It", render: (m) => (m.removed_at ? <Pill tone="neutral">Taken Off</Pill> : <Pill tone="ok">On It</Pill>) },
          { key: "r", label: "Reason", desktop: true, render: (m) => m.removed_reason },
          ...(a.can_change && active.length > 1
            ? [{ key: "x", label: "", render: (m: (typeof a.members)[number]) => (m.removed_at ? null : <Button size="sm" onClick={() => takeOff(m.employee)}>Take Off</Button>) }]
            : []),
        ]}
      />
      <FormFooter>
        {a.can_change && (
          <Button variant="danger" onClick={cancel}>
            Cancel Assignment
          </Button>
        )}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/** Cancel the assignment, or take one person off it, with the reason they read. */
function ChangeForm({ a, employee, close }: { a: FieldAssignment; employee?: PersonRef; close: () => void }) {
  const f = useContractForm({ reason: "" }, attendance.FieldAssignmentCancel);
  const cancel = useMutation("POST /api/v1/attendance/field-assignments/:id/cancel");
  const remove = useMutation("POST /api/v1/attendance/field-assignments/:id/remove");
  const submit = async () => {
    if (!f.check()) return;
    const reason = f.values.reason.trim();
    try {
      if (employee) await remove.run({ params: { id: a.field_assignment_id }, body: { employee_id: employee.employee_id, reason } });
      else await cancel.run({ params: { id: a.field_assignment_id }, body: { reason } });
      invalidate("/api/v1/attendance");
      close();
      toast(employee ? `${employee.display_name} taken off` : `${a.number} cancelled`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Not changed");
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Client moved it" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Keep It</Button>
        <Button variant="danger" busy={cancel.pending || remove.pending} onClick={submit}>
          {employee ? "Take Off" : "Cancel Assignment"}
        </Button>
      </FormFooter>
    </>
  );
}

/** My Attendance: the person's assignments in progress and to come, when there are any. */
export function MyFieldAssignments({ open }: { open: (a: FieldAssignment) => void }) {
  const list = usePaged("GET /api/v1/attendance/me/field-assignments");
  const current = list.rows.filter((a) => a.state === "in_progress" || a.state === "upcoming");
  if (!current.length) return null;
  return (
    <DataView
      className="mt-3"
      title="Field Assignments"
      rows={current}
      rowKey={(a) => a.field_assignment_id}
      onRowClick={open}
      noun="assignment"
      columns={[
        { key: "n", label: "Assignment", render: (a) => `${a.number} · ${a.name}` },
        { key: "d", label: "Dates", render: datesOf },
        { key: "x", label: "Site", render: (a) => a.sites.map((x) => x.name).join(" or ") },
        { key: "s", label: "State", desktop: true, render: assignmentPill },
      ]}
    />
  );
}
