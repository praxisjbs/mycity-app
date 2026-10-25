import { useMemo, useState, type ReactNode } from "react";
import organisation from "@mycity/contract/schemas/organisation.js";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { Department, Employee360 } from "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { DepartmentPicker, EmployeePicker, WorksitePicker, type WorksiteChoice } from "@/features/shared/pickers";
import { hrefFor, useRouter } from "@/lib/router";
import { useAddressPrefill } from "@/shell/screen-action";
import {
  Banner,
  Button,
  ChoiceField,
  DateField,
  Field,
  Form,
  FormError,
  FormFooter,
  MoneyField,
  PhoneField,
  SelectField,
  TextField,
  toast,
  todayIso,
  toMoneyString,
  useContractForm,
  Wizard,
  type WizardStep,
} from "@mycity/ui";

/**
 * Add Employee (a wizard) and Edit (one form), both on the contract (`EmployeeAdd`,
 * `EmployeeUpdate`), so every field is checked as it is filled by the rules the API enforces
 * and nothing is refused only at the end (docs/guides/foundation.md §6.16):
 *
 *  - the form holds only the fields it shows, so a check never fails on a field nobody can see;
 *  - each step checks every field it shows before Next, and a refusal from the server takes the
 *    person back to the step holding the field, or says it in one line above the footer;
 *  - a field the person's role hides (Me.hidden_fields) is left out: the API refuses it anyway;
 *  - someone who may only view the register is told so on the first step, not at the end.
 *
 * No login without an employee record (CLAUDE.md): Add Employee makes the record, and Send
 * Invite gives that person a login afterwards.
 */

const EMPLOYMENT: Array<[string, string]> = [
  ["full_time", "Full Time"],
  ["part_time", "Part Time"],
  ["contractor", "Contractor"],
  ["consultant", "Consultant"],
  ["intern", "Intern"],
];
const PATTERN: Array<[string, string]> = [
  ["on_site", "On Site"],
  ["hybrid", "Hybrid"],
  ["remote", "Remote"],
];
const GENDER: Array<[string, string]> = [
  ["female", "Female"],
  ["male", "Male"],
];
/** The patterns that come to a worksite (the contract's ON_SITE_PATTERNS). */
const ON_SITE: readonly string[] = organisation.ON_SITE_PATTERNS;

/** Every field the two forms may show, as the person types them. */
const ALL = {
  first_name: "",
  middle_name: "",
  last_name: "",
  work_email: "",
  phone: "",
  gender: "",
  date_of_birth: "",
  job_title: "",
  department_id: "",
  start_date: "",
  employment_type: "full_time",
  work_pattern: "on_site",
  worksite_id: "",
  contract_ends_on: "",
  confirmation_due_on: "",
  line_manager_id: "",
  gross_monthly: "",
  bank_name: "",
  account_number: "",
  next_of_kin_name: "",
  next_of_kin_phone: "",
  next_of_kin_relationship: "",
};
type Key = keyof typeof ALL;
/** The form's values: only the fields it shows are present (a form never holds a field nobody sees). */
type Values = Record<string, string>;

/** The wizard's topics, in order, and the fields each holds. */
const STEPS: Array<{ title: string; keys: Key[] }> = [
  { title: "Person", keys: ["first_name", "middle_name", "last_name", "work_email", "phone", "gender", "date_of_birth"] },
  { title: "Job", keys: ["job_title", "department_id", "start_date", "employment_type", "work_pattern", "worksite_id", "contract_ends_on", "confirmation_due_on", "line_manager_id"] },
  { title: "Pay and Bank", keys: ["gross_monthly", "bank_name", "account_number"] },
  { title: "Next of Kin", keys: ["next_of_kin_name", "next_of_kin_phone", "next_of_kin_relationship"] },
];
/** Fields Edit shows; the reporting line has its own form (Change Reporting Line). */
const EDIT_KEYS = STEPS.flatMap((s) => s.keys).filter((k) => k !== "line_manager_id");

/** The fields this person may set: their role's hidden ones left out. */
function useShown(keys: Key[]) {
  const hidden = useMe().hidden_fields;
  return useMemo(() => keys.filter((k) => !hidden.includes(k)), [keys, hidden]);
}

/** What the form holds as the API reads it: the amount as a two-place string, empties left for the contract. */
const toWire = (v: Values): Values => ({
  ...v,
  ...(v.gross_monthly !== undefined ? { gross_monthly: toMoneyString(v.gross_monthly) } : {}),
});

/** The contract, read through toWire, so a salary typed as "350,000" is checked as the API will see it. */
const checked = (schema: { safeParse: (v: unknown) => unknown }, pick: (v: Values) => Values = (v) => v) => ({
  safeParse: (v: unknown) => schema.safeParse(toWire(pick(v as Values))) as ReturnType<typeof organisation.EmployeeAdd.safeParse>,
});

/** A refusal's words for the line above the footer: the server's, or a plain retry. */
const lineFor = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : "Not saved. Check your connection and try again.");

/** Told on the first step, before anything is typed: this person may look but not add. */
function ViewOnly({ close }: { close: () => void }) {
  return (
    <>
      <Banner tone="info">You can view employees but not add them, so ask People to add this person.</Banner>
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/** The fields of one topic, each shown only when the person may set it. */
function Fields({ keys, f, departments, setDepartments, worksites, setWorksites, manager, setManager }: {
  keys: Key[];
  f: ReturnType<typeof useContractForm<Values>>;
  departments: Department[];
  setDepartments: (d: Department[]) => void;
  worksites: WorksiteChoice[];
  setWorksites: (w: WorksiteChoice[]) => void;
  manager?: PersonRef[];
  setManager?: (p: PersonRef[]) => void;
}) {
  const has = (k: Key) => keys.includes(k);
  const v = f.values;
  const onSite = ON_SITE.includes(v.work_pattern ?? "");
  const out: ReactNode[] = [];
  const add = (k: Key, node: ReactNode) => has(k) && out.push(<div key={k}>{node}</div>);
  add("first_name", <Field label="First Name" {...f.status("first_name")}><TextField {...f.field("first_name")} autoComplete="off" /></Field>);
  add("middle_name", <Field label="Middle Name" optional {...f.status("middle_name")}><TextField {...f.field("middle_name")} autoComplete="off" /></Field>);
  add("last_name", <Field label="Last Name" {...f.status("last_name")}><TextField {...f.field("last_name")} autoComplete="off" /></Field>);
  add("work_email", <Field label="Work Email" {...f.status("work_email")}><TextField type="email" {...f.field("work_email")} placeholder="name@mycityapp.io" /></Field>);
  add("phone", <Field label="Phone" {...f.status("phone")}><PhoneField {...f.field("phone")} /></Field>);
  add("gender", <Field label="Gender" optional {...f.status("gender")}><ChoiceField options={GENDER} {...f.field("gender")} /></Field>);
  add("date_of_birth", <Field label="Date of Birth" optional {...f.status("date_of_birth")}><DateField {...f.field("date_of_birth")} max={todayIso()} /></Field>);
  add("job_title", <Field label="Job Title" {...f.status("job_title")}><TextField {...f.field("job_title")} /></Field>);
  add(
    "department_id",
    <Field label="Department" {...f.status("department_id")}>
      <DepartmentPicker
        value={departments}
        onChange={(d) => {
          setDepartments(d);
          f.set("department_id", d[0]?.department_id ?? "");
        }}
      />
    </Field>,
  );
  add("start_date", <Field label="Start Date" {...f.status("start_date")}><DateField {...f.field("start_date")} /></Field>);
  add("employment_type", <Field label="Employment Type" {...f.status("employment_type")}><SelectField options={EMPLOYMENT} {...f.field("employment_type")} /></Field>);
  add("work_pattern", <Field label="Work Pattern" {...f.status("work_pattern")}><ChoiceField options={PATTERN} {...f.field("work_pattern")} /></Field>);
  add(
    "worksite_id",
    <Field label="Worksite" optional={!onSite} {...f.status("worksite_id")}>
      <WorksitePicker
        value={worksites}
        onChange={(w) => {
          setWorksites(w);
          f.set("worksite_id", w[0]?.worksite_id ?? "");
        }}
      />
    </Field>,
  );
  add("contract_ends_on", <Field label="Contract Ends" optional {...f.status("contract_ends_on")}><DateField {...f.field("contract_ends_on")} min={v.start_date || undefined} /></Field>);
  add("confirmation_due_on", <Field label="Probation Ends" optional {...f.status("confirmation_due_on")}><DateField {...f.field("confirmation_due_on")} min={v.start_date || undefined} /></Field>);
  if (manager && setManager)
    add(
      "line_manager_id",
      <Field label="Line Manager" optional {...f.status("line_manager_id")}>
        <EmployeePicker
          value={manager}
          filters={{ status: "active" }}
          onChange={(p) => {
            setManager(p);
            f.set("line_manager_id", p[0]?.employee_id ?? "");
          }}
          placeholder="Manager's name"
        />
      </Field>,
    );
  add("gross_monthly", <Field label="Gross Monthly" optional {...f.status("gross_monthly")}><MoneyField {...f.field("gross_monthly")} /></Field>);
  add("bank_name", <Field label="Bank" optional {...f.status("bank_name")}><TextField {...f.field("bank_name")} /></Field>);
  add(
    "account_number",
    <Field label="Account Number" optional {...f.status("account_number")}>
      <TextField {...f.field("account_number")} inputMode="numeric" onChange={(t: string) => f.set("account_number", t.replace(/\D/g, "").slice(0, 10))} />
    </Field>,
  );
  add("next_of_kin_name", <Field label="Next of Kin" optional {...f.status("next_of_kin_name")}><TextField {...f.field("next_of_kin_name")} /></Field>);
  add("next_of_kin_phone", <Field label="Next of Kin Phone" optional {...f.status("next_of_kin_phone")}><PhoneField {...f.field("next_of_kin_phone")} /></Field>);
  add("next_of_kin_relationship", <Field label="Relationship" optional {...f.status("next_of_kin_relationship")}><TextField {...f.field("next_of_kin_relationship")} /></Field>);
  return <>{out}</>;
}

export function AddEmployee({ close }: { close: () => void }) {
  const { can, refreshMe } = useAuth();
  const [viewOnly, setViewOnly] = useState(false);
  if (!can("people", "create") || viewOnly) return <ViewOnly close={close} />;
  return <AddWizard close={close} onRefused={() => void refreshMe().finally(() => setViewOnly(true))} />;
}

function AddWizard({ close, onRefused }: { close: () => void; onRefused: () => void }) {
  const shown = useShown(STEPS.flatMap((s) => s.keys));
  const steps = STEPS.map((s) => ({ ...s, keys: s.keys.filter((k) => shown.includes(k)) })).filter((s) => s.keys.length);
  // Opened by Praxis AI's Add Employee button: the names and the job it was told, nothing personal.
  const filled = useAddressPrefill(organisation.EmployeePrefill);
  const initial = useMemo(() => Object.fromEntries(shown.map((k) => [k, (filled as Values)[k] ?? ALL[k]])) as Values, [shown, filled]);
  const f = useContractForm<Values>(initial, checked(organisation.EmployeeAdd));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [worksites, setWorksites] = useState<WorksiteChoice[]>([]);
  const [manager, setManager] = useState<PersonRef[]>([]);
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("POST /api/v1/employees");
  const { navigate } = useRouter();
  const stepOf = (keys: string[]) => steps.findIndex((s) => s.keys.some((k) => keys.includes(k)));

  const submit = async () => {
    setError(null);
    if (!f.check()) {
      const bad = stepOf(Object.keys(f.errors));
      if (bad >= 0) setAt(bad);
      return;
    }
    try {
      const employee = await save.run({ body: toWire(f.values) as never });
      invalidate("/api/v1/employees");
      invalidate("/api/v1/org-chart");
      invalidate("/api/v1/departments");
      invalidate("/api/v1/users");
      close();
      toast(`${employee.display_name} added as ${employee.staff_number}`);
      navigate(hrefFor("people", "employees", { id: employee.employee_id }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && !Object.keys(e.fields).length) return onRefused();
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(e.fields);
        const step = stepOf(Object.keys(e.fields));
        if (step >= 0) return setAt(step);
      }
      setError(lineFor(e));
    }
  };

  const wizardSteps: WizardStep[] = steps.map((s) => ({
    title: s.title,
    check: () => f.check(s.keys),
    body: <Fields keys={s.keys} f={f} departments={departments} setDepartments={setDepartments} worksites={worksites} setWorksites={setWorksites} manager={manager} setManager={setManager} />,
  }));

  return (
    <Wizard
      finish="Add Employee"
      busy={save.pending}
      onFinish={submit}
      onCancel={close}
      steps={wizardSteps}
      step={at}
      onStepChange={(i) => {
        setError(null);
        setAt(i);
      }}
      error={error}
    />
  );
}

/** Edit: the record's own fields, checked by `EmployeeUpdate`; only what the person changed is sent. */
export function EditEmployee({ employee, close }: { employee: Employee360; close: () => void }) {
  const shown = useShown(EDIT_KEYS);
  const start = useMemo<Values>(() => {
    const record = employee as unknown as Record<string, string | null | undefined>;
    return Object.fromEntries(shown.map((k) => [k, record[k] ?? ""])) as Values;
  }, [employee, shown]);
  /* Only the fields the person changed are checked and sent: a stored value from an old import
     never blocks a correction somewhere else, and a field emptied here is cleared. */
  const changedOf = (v: Values) => Object.fromEntries((Object.keys(v) as Key[]).filter((k) => v[k] !== start[k]).map((k) => [k, v[k]])) as Values;
  const dates = ["contract_ends_on", "confirmation_due_on", "date_of_birth"];
  const withStart = (v: Values): Values => {
    const changed = changedOf(v);
    const dated = Object.keys(changed).some((k) => dates.includes(k));
    return dated && v.start_date && !("start_date" in changed) ? { ...changed, start_date: v.start_date } : changed;
  };
  const f = useContractForm<Values>(start, checked(organisation.EmployeeUpdate, withStart));
  const [departments, setDepartments] = useState<Department[]>([{ department_id: employee.department_id, name: employee.department } as Department]);
  const site = useApi("GET /api/v1/worksites/:id", { params: { id: employee.worksite_id ?? "" }, enabled: !!employee.worksite_id });
  const [picked, setWorksites] = useState<WorksiteChoice[] | null>(null);
  const worksites = picked ?? (site.data ? [{ worksite_id: site.data.worksite_id, name: site.data.name, code: site.data.code }] : []);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("PATCH /api/v1/employees/:id");

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const changed = changedOf(f.values);
    if (Object.keys(changed).length === 0) return close();
    try {
      await save.run({ params: { id: employee.employee_id }, body: toWire(changed) as never });
      invalidate("/api/v1/employees");
      invalidate("/api/v1/org-chart");
      invalidate("/api/v1/departments");
      close();
      toast(`${employee.display_name} saved`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        f.setServerErrors(e.fields);
        if (Object.keys(e.fields).some((k) => shown.includes(k as Key))) return;
      }
      setError(lineFor(e));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Fields keys={shown} f={f} departments={departments} setDepartments={setDepartments} worksites={worksites} setWorksites={setWorksites} />
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.pending}>
          Save Record
        </Button>
      </FormFooter>
    </Form>
  );
}
