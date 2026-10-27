import { useMemo, useState, type ReactNode } from "react";
import organisation from "@mycity/contract/schemas/organisation.js";
import type { Department, EmployeeRow } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { DepartmentPicker, EmployeePicker } from "@/features/shared/pickers";
import { hrefFor, useRouter, useSearchParams } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  ChoiceField,
  Chips,
  DataView,
  Field,
  Form,
  FormError,
  FormFooter,
  HelpTerm,
  IconButton,
  KeyValue,
  ListDetail,
  Menu,
  PageHeader,
  Pill,
  SearchInput,
  SelectField,
  TextField,
  toast,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";

/**
 * People · Departments (#103, `departments`; docs/guides/organogram.md §6.1, §10): MyCity's
 * functions, kept here and nowhere in code. A department opens beside the list on desktop and in
 * a sheet on a phone (F31), with its head, its people and what the reader's `people` grant lets
 * them do: Set Head, Add People, Edit Department, and behind More Actions Merge, Retire or
 * Restore, and Delete for one never used. The server moves the reporting lines and the head's
 * role with each change.
 */

type Shown = "true" | "false" | "all";

const HELP = {
  code: "Starts the codes of its goals and KPIs, such as BM-O1. Codes already set keep theirs.",
  head: "Sets this function's goals on Performance. Anyone who reported to the last head reports to the new one.",
  acting: "The head's role is open, so the first person above it acts as head.",
} as const;

/** What a refusal says, or a plain retry when the server could not be reached. */
const sayRefusal = (e: unknown, fallback: string) => toast.error(e instanceof ApiError && e.status !== 0 && e.message ? e.message : fallback);
const lineFor = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : "Not saved. Check your connection and try again.");

/** A short code from a name: the initials of two words or more, else the first three letters. */
export function suggestCode(name: string): string {
  const words = name.split(/[^A-Za-z]+/).filter(Boolean);
  if (!words.length) return "";
  const code = words.length > 1 ? words.map((w) => w[0]).join("") : words[0].slice(0, 3);
  return code.toUpperCase().slice(0, 10);
}

/** A department's state as its pill reads it. */
function statusOf(d: Department) {
  if (d.active) return { tone: "ok" as const, text: "In Use" };
  return { tone: "neutral" as const, text: d.merged_into ? "Merged" : "Retired" };
}

/** Who heads it, as a line: a person, or the open role and who acts for it. */
const headLine = (d: Department) => (d.head ? (d.head.vacant ? `${d.head.display_name} (open)` : d.head.display_name) : null);

export function Departments() {
  const { can } = useAuth();
  const modal = useModal();
  const [params] = useSearchParams();
  const [shown, setShown] = useState<Shown>("true");
  const list = usePaged("GET /api/v1/departments", { filters: shown === "all" ? {} : { active: shown }, sort: "name" });
  const inUse = useApi("GET /api/v1/departments", { query: { active: "true" } });
  const retired = useApi("GET /api/v1/departments", { query: { active: "false" } });
  const beside = useSideBySide();
  // `?id=` (⌘K, a link) opens the department it names, on a phone as well.
  const linkedId = params.get("id");
  const linked = useApi("GET /api/v1/departments/:id", { params: { id: linkedId ?? "" }, enabled: Boolean(linkedId) });
  const [picked, setPicked] = useState<Department | null>(null);
  const [closedLink, setClosedLink] = useState(false);
  const pinned = picked ?? (!closedLink && linked.data ? linked.data : null);
  // Side by side the first department shows unasked; on a phone nothing opens until a row is tapped (F31).
  const sel = pinned ?? (beside ? (list.rows[0] ?? null) : null);
  const add = () => modal.open({ title: "Add Department", body: (close) => <AddDepartment close={close} onAdded={setPicked} /> });
  useScreenAction(can("people", "create") ? { label: "Add Department", onSelect: add } : null);
  // Praxis AI's Add Department opens the form on `?new=1` (organisation.ai.js), for those who may add one.
  useNewLink(can("people", "create") ? add : null);
  const counts =
    inUse.data && retired.data ? `${inUse.data.page.total} in use · ${retired.data.page.total} retired` : " ";

  return (
    <>
      <PageHeader
        title="Departments"
        sub={counts}
        actions={
          can("people", "create") && (
            <Button variant="primary" icon="plus" onClick={add}>
              Add Department
            </Button>
          )
        }
      />
      <ListDetail
        open={pinned !== null}
        onClose={() => (setPicked(null), setClosedLink(true))}
        title="Department"
        list={
          <>
            <Toolbar>
              <SearchInput value={list.q} onChange={list.setQ} placeholder="Name or code" className="w-full md:w-64" />
            </Toolbar>
            <Chips
              value={shown}
              onChange={(v) => setShown(v as Shown)}
              options={[
                ["true", "In Use"],
                ["false", "Retired"],
                ["all", "All"],
              ]}
            />
            <DataView
              title="All Departments"
              list={list}
              rowKey={(r) => r.department_id}
              selectedKey={sel?.department_id}
              onRowClick={(r) => setPicked(r)}
              empty={{ title: "No Departments", text: "Clear the search or add one." }}
              noun="department"
              columns={[
                { key: "name", label: "Department", sortable: true, render: (r) => <Who name={r.name} sub={r.code} /> },
                { key: "h", label: "Head", render: (r) => headLine(r) ?? "None" },
                { key: "headcount", label: "People", sortable: true, align: "n", render: (r) => r.headcount },
                { key: "o", label: "Open Roles", desktop: true, align: "n", render: (r) => r.open_roles },
                { key: "s", label: "Status", render: (r) => <Pill tone={statusOf(r).tone}>{statusOf(r).text}</Pill> },
              ]}
            />
          </>
        }
        detail={
          sel ? (
            <DepartmentRecord key={sel.department_id} id={sel.department_id} onGone={() => (setPicked(null), setClosedLink(true))} />
          ) : (
            <Card>
              <p className="text-xs text-subtle-foreground">Select a department to see its people.</p>
            </Card>
          )
        }
      />
    </>
  );
}

/** One department: its head, people and roles, and what the reader may do to it. */
function DepartmentRecord({ id, onGone }: { id: string; onGone: () => void }) {
  const { can } = useAuth();
  const modal = useModal();
  const confirm = useConfirm();
  const { navigate } = useRouter();
  const read = useApi("GET /api/v1/departments/:id", { params: { id } });
  const people = usePaged("GET /api/v1/employees", { filters: { department_id: id }, sort: "display_name" });
  const photo = usePhotos(people.rows.map((r) => r.photo_url));
  const patch = useMutation("PATCH /api/v1/departments/:id");
  const remove = useMutation("DELETE /api/v1/departments/:id");
  const d = read.data;
  if (!d) return <Card>{read.error ? <p className="text-xs text-subtle-foreground">This department could not be loaded.</p> : null}</Card>;

  const edit = can("people", "edit");
  const status = statusOf(d);
  const refresh = () => {
    invalidate("/api/v1/departments");
    invalidate("/api/v1/employees");
    invalidate("/api/v1/org-chart");
    invalidate("/api/v1/org-seats");
  };
  const open = (title: string, body: (close: () => void) => ReactNode) => modal.open({ title, body });
  const setHead = () => open("Set Head", (close) => <SetHeadForm department={d} close={close} onDone={refresh} />);
  const addPeople = () => open("Add People", (close) => <AddPeopleForm department={d} close={close} onDone={refresh} />);
  const editIt = () => open("Edit Department", (close) => <EditDepartment department={d} close={close} onDone={refresh} />);
  const merge = () => open("Merge Department", (close) => <MergeForm department={d} close={close} onDone={refresh} />);
  const moveOne = (r: EmployeeRow) => open("Move Person", (close) => <MoveForm person={r} close={close} onDone={refresh} />);

  const retire = async () => {
    if (!(await confirm({ title: "Retire Department", body: `${d.name} leaves the lists until restored.`, confirmLabel: "Retire Department", destructive: true }))) return;
    try {
      await patch.run({ params: { id }, body: { active: false } });
      refresh();
      toast("Department retired");
    } catch (e) {
      sayRefusal(e, "Not retired. Try again.");
    }
  };
  const restore = async () => {
    try {
      await patch.run({ params: { id }, body: { active: true } });
      refresh();
      toast("Department restored");
    } catch (e) {
      sayRefusal(e, "Not restored. Try again.");
    }
  };
  const deleteIt = async () => {
    if (!(await confirm({ title: "Delete Department", body: `${d.name} is removed for good.`, confirmLabel: "Delete Department", destructive: true }))) return;
    try {
      await remove.run({ params: { id } });
      refresh();
      toast("Department deleted");
      onGone();
    } catch (e) {
      sayRefusal(e, "Not deleted. Try again.");
    }
  };

  const more = [
    ...(edit && d.active ? [{ label: "Merge Department", icon: "users" as const, onSelect: merge }] : []),
    ...(edit && d.active ? [{ label: "Retire Department", icon: "x" as const, onSelect: retire }] : []),
    ...(can("people", "delete") && d.can_delete ? ["sep" as const, { label: "Delete Department", icon: "trash" as const, danger: true, onSelect: deleteIt }] : []),
  ];

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader title={d.name} record actions={<Pill tone={status.tone}>{status.text}</Pill>} />
        <KeyValue
          items={[
            [<HelpTerm key="c" help={HELP.code}>Code</HelpTerm>, d.code],
            [<HelpTerm key="h" help={HELP.head}>Head</HelpTerm>, headLine(d) ?? "None"],
            ...(d.head?.vacant && d.acting_head ? ([[<HelpTerm key="a" help={HELP.acting}>Acting Head</HelpTerm>, d.acting_head.display_name]] as const) : []),
            ["People", String(d.headcount)],
            ["Open Roles", String(d.open_roles)],
            ...(d.merged_into ? ([["Merged Into", d.merged_into.name]] as const) : []),
          ]}
        />
        {edit && (
          <div className="mt-3 flex flex-wrap gap-2 phone:flex-col phone:items-stretch">
            <ActionGroup>
              {d.active ? (
                <>
                  <Button variant="primary" icon="user" onClick={setHead}>
                    Set Head
                  </Button>
                  <Button icon="plus" onClick={addPeople}>
                    Add People
                  </Button>
                  <Button icon="edit" onClick={editIt}>
                    Edit Department
                  </Button>
                </>
              ) : (
                <Button variant="primary" busy={patch.pending} onClick={restore}>
                  Restore Department
                </Button>
              )}
              {more.length > 0 && <Menu label="Department actions" trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={more} />}
            </ActionGroup>
          </div>
        )}
      </Card>
      <DataView
        title="People"
        list={people}
        rowKey={(r) => r.employee_id}
        onRowClick={(r) => navigate(hrefFor("people", "employees", { id: r.employee_id }))}
        empty={{ title: "Nobody Here Yet", text: d.active && edit ? "Add People moves staff in." : "Nobody works here now." }}
        noun="person"
        nounPlural="people"
        columns={[
          { key: "display_name", label: "Employee", render: (r) => <Who name={r.display_name} sub={r.job_title} src={photo(r.photo_url)} /> },
          { key: "m", label: "Reports To", render: (r) => r.line_manager?.display_name ?? "None" },
          ...(edit && d.active
            ? [{ key: "x", label: "", desktop: true, render: (r: EmployeeRow) => <Button size="sm" onClick={(e) => (e.stopPropagation(), moveOne(r))}>Move To</Button> }]
            : []),
        ]}
      />
    </div>
  );
}

/** Add Department: its name, a code offered from the name, and a head if there is one yet. */
export function AddDepartment({ close, onAdded }: { close: () => void; onAdded: (d: Department) => void }) {
  const [codeTouched, setCodeTouched] = useState(false);
  const [head, setHead] = useState<PersonRef[]>([]);
  const create = useMutation("POST /api/v1/departments");
  const [error, setError] = useState<string | null>(null);
  // An empty code is left out: the server makes one from the name.
  const checked = useMemo(
    () => ({ safeParse: (v: unknown) => organisation.DepartmentCreate.safeParse(withoutBlanks(v as Record<string, string>)) }),
    [],
  );
  const f = useContractForm<Record<string, string>>({ name: "", code: "" }, checked);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    try {
      const made = await create.run({
        body: { ...withoutBlanks(f.values), ...(head[0] ? { head_employee_id: head[0].employee_id } : {}) } as never,
      });
      invalidate("/api/v1/departments");
      invalidate("/api/v1/employees");
      close();
      toast(`${made.name} added`);
      onAdded(made);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(e.fields);
        if (Object.keys(e.fields).some((k) => k === "name" || k === "code")) return;
      }
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Name" {...f.status("name")}>
        <TextField
          {...f.field("name")}
          placeholder="Finance & Admin"
          onChange={(t: string) => {
            f.set("name", t);
            if (!codeTouched) f.set("code", suggestCode(t));
          }}
        />
      </Field>
      <Field label="Code" optional help={HELP.code} {...f.status("code")}>
        <TextField
          {...f.field("code")}
          placeholder="FA"
          onChange={(t: string) => {
            setCodeTouched(true);
            f.set("code", t.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 10));
          }}
        />
      </Field>
      <Field label="Head" optional help={HELP.head}>
        <EmployeePicker value={head} onChange={setHead} filters={{ status: "active" }} placeholder="Head's name" />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={create.pending}>
          Add Department
        </Button>
      </FormFooter>
    </Form>
  );
}

/** The form's values without the empty ones, as the contract reads an optional field left blank. */
function withoutBlanks(v: Record<string, string>) {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined));
}

/** Edit Department: its name and code; only what changed is checked and sent. */
function EditDepartment({ department: d, close, onDone }: { department: Department; close: () => void; onDone: () => void }) {
  const start = useMemo(() => ({ name: d.name, code: d.code }), [d]);
  const changedOf = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== start[k as "name" | "code"]));
  const checked = useMemo(
    () => ({
      safeParse: (v: unknown) => {
        const changed = changedOf(v as Record<string, string>);
        return Object.keys(changed).length ? organisation.DepartmentUpdate.safeParse(changed) : { success: true as const, data: {} };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start],
  );
  const f = useContractForm<Record<string, string>>(start, checked);
  const save = useMutation("PATCH /api/v1/departments/:id");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const changed = changedOf(f.values);
    if (!Object.keys(changed).length) return close();
    try {
      const saved = await save.run({ params: { id: d.department_id }, body: changed });
      onDone();
      close();
      toast(`${saved.name} saved`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(e.fields);
        return;
      }
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} />
      </Field>
      <Field label="Code" help={HELP.code} {...f.status("code")}>
        <TextField {...f.field("code")} onChange={(t: string) => f.set("code", t.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 10))} />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.pending}>
          Save Department
        </Button>
      </FormFooter>
    </Form>
  );
}

type HeadKind = "person" | "seat" | "none";

/** Set Head: a person, one of this department's open roles, or nobody. Lines and the role follow on the server. */
export function SetHeadForm({ department: d, close, onDone }: { department: Department; close: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<HeadKind>(d.head?.vacant ? "seat" : d.head ? "person" : "person");
  const [person, setPerson] = useState<PersonRef[]>(
    d.head && d.head.employee_id && !d.head.vacant
      ? [{ employee_id: d.head.employee_id, display_name: d.head.display_name, job_title: d.head.job_title, department: d.name }]
      : [],
  );
  const seats = usePaged("GET /api/v1/org-seats", { filters: { status: "vacant", department_id: d.department_id } });
  const [seat, setSeat] = useState<string>(d.head?.vacant ? (d.head.org_seat_id ?? "") : "");
  const [mark, setMark] = useState<{ person?: string; seat?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("PATCH /api/v1/departments/:id");

  const submit = async () => {
    setError(null);
    if (kind === "person" && !person.length) return setMark({ person: "Pick someone" });
    if (kind === "seat" && !seat) return setMark({ seat: "Pick an open role" });
    const body =
      kind === "person"
        ? { head_employee_id: person[0].employee_id }
        : kind === "seat"
          ? { head_seat_id: seat }
          : { head_employee_id: null, head_seat_id: null };
    try {
      const saved = await save.run({ params: { id: d.department_id }, body });
      onDone();
      close();
      toast(saved.head ? `${saved.head.display_name} now heads ${saved.name}` : `${saved.name} has no head`);
    } catch (e) {
      if (e instanceof ApiError && (e.fields.head_employee_id || e.fields.head_seat_id)) {
        return setMark({ person: e.fields.head_employee_id?.[0], seat: e.fields.head_seat_id?.[0] });
      }
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Head Is" help={HELP.head}>
        <ChoiceField<HeadKind>
          value={kind}
          onChange={(k) => (setKind(k), setMark({}))}
          options={[
            ["person", "A Person"],
            ["seat", "An Open Role"],
            ["none", "Nobody"],
          ]}
        />
      </Field>
      {kind === "person" && (
        <Field label="Head" state={mark.person ? "bad" : undefined} message={mark.person}>
          <EmployeePicker value={person} onChange={(v) => (setPerson(v), setMark({}))} filters={{ status: "active" }} placeholder="Head's name" />
        </Field>
      )}
      {kind === "seat" && (
        <Field label="Open Role" state={mark.seat ? "bad" : undefined} message={mark.seat}>
          <SelectField
            value={seat}
            onChange={(v) => (setSeat(v), setMark({}))}
            placeholder={seats.rows.length ? "Open role" : "No open roles"}
            options={seats.rows.map((s) => [s.org_seat_id, s.title] as [string, string])}
          />
        </Field>
      )}
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.pending}>
          Set Head
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Add People: staff move in, each reporting to the head unless their manager is already here. */
function AddPeopleForm({ department: d, close, onDone }: { department: Department; close: () => void; onDone: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [mark, setMark] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const move = useMutation("POST /api/v1/departments/:id/people");

  const submit = async () => {
    setError(null);
    if (!who.length) return setMark("Pick someone");
    if (who.length > 25) return setMark("At most 25 people");
    try {
      await move.run({ params: { id: d.department_id }, body: { employee_ids: who.map((p) => p.employee_id) } });
      onDone();
      close();
      toast(`${who.length === 1 ? who[0].display_name : `${who.length} people`} moved to ${d.name}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields.employee_ids?.length) return setMark(e.fields.employee_ids[0]);
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="People" state={mark ? "bad" : undefined} message={mark ?? undefined}>
        <EmployeePicker value={who} onChange={(v) => (setWho(v), setMark(null))} multiple filters={{ status: "active" }} placeholder="Search staff" />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={move.pending}>
          Add People
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Move one person, or the people picked on People · Employees, into another department. */
export function MoveForm({ person, people, close, onDone }: { person?: EmployeeRow; people?: EmployeeRow[]; close: () => void; onDone: () => void }) {
  const moving = people ?? (person ? [person] : []);
  const [to, setTo] = useState<Department[]>([]);
  const [mark, setMark] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const move = useMutation("POST /api/v1/departments/:id/people");

  const submit = async () => {
    setError(null);
    if (!to.length) return setMark("Pick a department");
    try {
      await move.run({ params: { id: to[0].department_id }, body: { employee_ids: moving.map((p) => p.employee_id) } });
      onDone();
      close();
      toast(`${moving.length === 1 ? moving[0].display_name : `${moving.length} people`} moved to ${to[0].name}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return setMark("Department retired");
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Department" state={mark ? "bad" : undefined} message={mark ?? undefined}>
        <DepartmentPicker value={to} onChange={(v) => (setTo(v), setMark(null))} />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={move.pending}>
          {moving.length === 1 ? "Move Person" : "Move People"}
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Merge Department: its people and open roles go into another department in use, and it retires. */
function MergeForm({ department: d, close, onDone }: { department: Department; close: () => void; onDone: () => void }) {
  const [into, setInto] = useState<Department[]>([]);
  const [mark, setMark] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const merge = useMutation("POST /api/v1/departments/:id/merge");

  const submit = async () => {
    setError(null);
    if (!into.length) return setMark("Pick a department");
    try {
      const target = await merge.run({ params: { id: d.department_id }, body: { into_department_id: into[0].department_id } });
      onDone();
      close();
      toast(`${d.name} merged into ${target.name}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields.into_department_id?.length) return setMark(e.fields.into_department_id[0]);
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Into" state={mark ? "bad" : undefined} message={mark ?? undefined}>
        <DepartmentPicker value={into} onChange={(v) => (setInto(v), setMark(null))} />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="danger" busy={merge.pending}>
          Merge Department
        </Button>
      </FormFooter>
    </Form>
  );
}
