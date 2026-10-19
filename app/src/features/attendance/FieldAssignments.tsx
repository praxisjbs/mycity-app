import attendance from "@mycity/contract/schemas/attendance.js";
import type { FieldAssignment, FieldAssignmentCreate, FieldAssignmentState } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { Button, Card, CardHeader, Chips, ChoiceField, DataView, DateField, Field, formatDate, formatDateTime, FormFooter, Grid, HelpTerm, KeyValue, NumberField, Pill, TextAreaField, TextField, toast, todayIso, useContractForm, useModal, Who } from "@mycity/ui";
import { ASSIGNMENT_STATE } from "./labels";

/**
 * Field assignments (docs/guides/attendance.md §6.12, §10): People · Attendance's Field view, where a
 * line manager or People send people to one or two sites for some days, cancel it or take someone
 * off; and on My Attendance, the person's own in progress and to come. The API decides who may set
 * or change one; `can_change` says whether this reader may.
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
  return (
    <>
      <Chips label="Field Assignments" value={state} onChange={setState} options={STATE_CHIPS} />
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
        onRowClick={a.can_change && active.length > 1 ? (m) => !m.removed_at && takeOff(m.employee) : undefined}
        noun="person"
        nounPlural="people"
        columns={[
          { key: "e", label: "Employee", render: (m) => <Who name={m.employee.display_name} sub={m.employee.department} /> },
          { key: "s", label: "On It", render: (m) => (m.removed_at ? <Pill tone="neutral">Taken Off</Pill> : <Pill tone="ok">On It</Pill>) },
          { key: "r", label: "Reason", desktop: true, render: (m) => m.removed_reason },
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

type SiteKey = "name" | "address" | "latitude" | "longitude" | "radius";
type Values = {
  name: string;
  client: string;
  note: string;
  starts_on: string;
  ends_on: string;
  people: PersonRef[];
  count: "1" | "2";
} & Record<`s${1 | 2}_${SiteKey}`, string>;

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const siteOf = (v: Values, n: 1 | 2) => ({
  name: v[`s${n}_name`],
  ...(v[`s${n}_address`].trim() && { address: v[`s${n}_address`].trim() }),
  latitude: num(v[`s${n}_latitude`]),
  longitude: num(v[`s${n}_longitude`]),
  radius_m: num(v[`s${n}_radius`]),
});
/** The body the API takes. */
const bodyOf = (v: Values) => ({
  name: v.name.trim(),
  client: v.client.trim(),
  ...(v.note.trim() && { note: v.note.trim() }),
  starts_on: v.starts_on,
  ends_on: v.ends_on,
  employee_ids: v.people.map((p) => p.employee_id),
  sites: v.count === "2" ? [siteOf(v, 1), siteOf(v, 2)] : [siteOf(v, 1)],
});
/** The contract's paths on the form's fields: a site's are per site, the people one field. */
const fieldOf = (path: PropertyKey[]): string => {
  if (path[0] === "employee_ids") return "people";
  if (path[0] === "sites") {
    const key = String(path[2] ?? "name");
    return `s${Number(path[1] ?? 0) + 1}_${key === "radius_m" ? "radius" : key}`;
  }
  return String(path[0]);
};
const remap = (fields: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === "employee_ids" ? "people" : k, v]));

const blankSite = (n: 1 | 2) => ({ [`s${n}_name`]: "", [`s${n}_address`]: "", [`s${n}_latitude`]: "", [`s${n}_longitude`]: "", [`s${n}_radius`]: "200" });

/** New Assignment: who, where, which days. In force once saved; each person is told. */
export function NewAssignmentForm({ close }: { close: () => void }) {
  const f = useContractForm<Values>(
    { name: "", client: "", note: "", starts_on: "", ends_on: "", people: [], count: "1", ...blankSite(1), ...blankSite(2) } as unknown as Values,
    {
      safeParse: (v: unknown) => {
        const r = attendance.FieldAssignmentCreate.safeParse(bodyOf(v as Values));
        if (r.success) return r;
        return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [fieldOf(i.path)] })) } };
      },
    },
  );
  const save = useMutation("POST /api/v1/attendance/field-assignments");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      // Checked against the contract above, so every number is one.
      const a = await save.run({ body: bodyOf(v) as FieldAssignmentCreate });
      invalidate("/api/v1/attendance");
      close();
      toast(`${a.number} set, ${a.people} told`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(remap(e.fields));
        // Who is already out on those days: the mark on First Day cannot say.
        if (e.code === "ASSIGNMENT_OVERLAPS") toast(e.message);
      } else toast(e instanceof ApiError ? e.message : "Assignment not saved");
    }
  };
  const site = (n: 1 | 2) => (
    <Card className="mt-3" key={n}>
      <CardHeader title={n === 1 ? (v.count === "2" ? "First Site" : "Site") : "Second Site"} />
      <Field label="Site Name" {...f.status(`s${n}_name`)}>
        <TextField {...f.field(`s${n}_name`)} placeholder="Expo Hall" maxLength={120} />
      </Field>
      <Field label="Address" optional {...f.status(`s${n}_address`)}>
        <TextField {...f.field(`s${n}_address`)} placeholder="Street, area, city" maxLength={300} />
      </Field>
      <Grid cols={2}>
        <Field label="Latitude" {...f.status(`s${n}_latitude`)}>
          <NumberField decimal {...f.field(`s${n}_latitude`)} placeholder="6.4281" />
        </Field>
        <Field label="Longitude" {...f.status(`s${n}_longitude`)}>
          <NumberField decimal {...f.field(`s${n}_longitude`)} placeholder="3.4219" />
        </Field>
      </Grid>
      <Field label={<HelpTerm help="A punch within this distance of the site counts at the site. Between 100 and 500 metres.">Radius, Metres</HelpTerm>} {...f.status(`s${n}_radius`)}>
        <NumberField {...f.field(`s${n}_radius`)} />
      </Field>
    </Card>
  );
  return (
    <>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Stand Build" maxLength={120} />
      </Field>
      <Field label="Client or Event" {...f.status("client")}>
        <TextField {...f.field("client")} placeholder="Example Expo" maxLength={120} />
      </Field>
      <Field label="People" {...f.status("people")}>
        <EmployeePicker multiple value={v.people} onChange={(p) => f.set("people", p)} placeholder="Search people" />
      </Field>
      <Grid cols={2}>
        <Field label="First Day" {...f.status("starts_on")}>
          <DateField {...f.field("starts_on")} min={todayIso()} />
        </Field>
        <Field label="Last Day" {...f.status("ends_on")}>
          <DateField {...f.field("ends_on")} min={v.starts_on || todayIso()} />
        </Field>
      </Grid>
      <Field label="Sites" {...f.status("count")}>
        <ChoiceField value={v.count} onChange={(c) => f.set("count", c)} options={[["1", "One Site"], ["2", "Two Sites"]] as Array<["1" | "2", string]>} />
      </Field>
      {site(1)}
      {v.count === "2" && site(2)}
      <Field label="Note" optional className="mt-3" {...f.status("note")}>
        <TextAreaField {...f.field("note")} placeholder="Badges at gate" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Save Assignment</Button>
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
