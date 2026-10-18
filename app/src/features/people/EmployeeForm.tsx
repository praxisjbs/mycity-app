import { useMemo, useState } from "react";
import organisation from "@mycity/contract/schemas/organisation.js";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { Employee360, EmployeeCreate } from "@/api/types/organisation";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { hrefFor, useRouter } from "@/lib/router";
import {
  Button,
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
  useContractForm,
  Wizard,
  type WizardStep,
} from "@mycity/ui";

/**
 * Add Employee and Edit, both on the contract (`EmployeeCreate`, `EmployeeUpdate`), so
 * the form is checked as it is filled by the same rules the API enforces, and a 422
 * lands on the field it names (FRONTEND_GUIDE §8).
 *
 * No login without an employee record (CLAUDE.md): Add Employee makes the record, and
 * Send Invite gives that person a login afterwards.
 */

const EMPLOYMENT: Array<[EmployeeCreate["employment_type"], string]> = [
  ["full_time", "Full Time"],
  ["part_time", "Part Time"],
  ["contractor", "Contractor"],
  ["consultant", "Consultant"],
  ["intern", "Intern"],
];
const PATTERN: Array<[EmployeeCreate["work_pattern"], string]> = [
  ["on_site", "On Site"],
  ["hybrid", "Hybrid"],
  ["remote", "Remote"],
];
const GENDER: Array<[string, string]> = [
  ["", "Not recorded"],
  ["female", "Female"],
  ["male", "Male"],
];

/** The fields both forms hold, as the person types them. */
const blank = {
  first_name: "",
  middle_name: "",
  last_name: "",
  work_email: "",
  phone: "",
  job_title: "",
  department_id: "",
  employment_type: "full_time",
  work_pattern: "hybrid",
  start_date: "",
  contract_ends_on: "",
  confirmation_due_on: "",
  gender: "",
  date_of_birth: "",
  personal_email: "",
  home_address: "",
  next_of_kin_name: "",
  next_of_kin_phone: "",
  next_of_kin_relationship: "",
  bank_name: "",
  account_number: "",
  gross_monthly: "",
};

type Values = typeof blank;

/** The department picker's options, from the organisation's own list. */
function useDepartments() {
  const list = usePaged("GET /api/v1/departments");
  return list.rows.map((d) => [d.department_id, d.name] as [string, string]);
}

export function AddEmployee({ close }: { close: () => void }) {
  const departments = useDepartments();
  const [manager, setManager] = useState<PersonRef[]>([]);
  const f = useContractForm<Values>(blank, organisation.EmployeeCreate);
  const save = useMutation("POST /api/v1/employees");
  const { navigate } = useRouter();

  const submit = async () => {
    if (!f.check()) return;
    try {
      const employee = await save.run({
        body: {
          ...(f.values as unknown as EmployeeCreate),
          ...(manager[0] ? { line_manager_id: manager[0].employee_id } : {}),
        },
      });
      invalidate("/api/v1/employees", "/api/v1/org-chart");
      close();
      toast(`${employee.display_name} added as ${employee.staff_number}`);
      navigate(hrefFor("people", "employees", { id: employee.employee_id }));
    } catch {
      f.setServerErrors(save.fields);
    }
  };

  const step = (title: string, keys: Array<keyof Values>, body: React.ReactNode): WizardStep => ({
    title,
    body,
    check: () => f.check(keys),
  });

  return (
    <Wizard
      finish="Add Employee"
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        step("Person", ["first_name", "last_name", "work_email", "phone"], (
          <>
            <Field label="First Name" {...f.field("first_name")}>
              <TextField {...f.field("first_name")} autoComplete="off" />
            </Field>
            <Field label="Middle Name" optional {...f.field("middle_name")}>
              <TextField {...f.field("middle_name")} autoComplete="off" />
            </Field>
            <Field label="Last Name" {...f.field("last_name")}>
              <TextField {...f.field("last_name")} autoComplete="off" />
            </Field>
            <Field label="Work Email" {...f.field("work_email")}>
              <TextField type="email" {...f.field("work_email")} placeholder="name@mycityapp.io" />
            </Field>
            <Field label="Phone" {...f.field("phone")}>
              <PhoneField {...f.field("phone")} />
            </Field>
            <Field label="Gender" optional {...f.field("gender")}>
              <SelectField options={GENDER} {...f.field("gender")} />
            </Field>
          </>
        )),
        step("Job", ["job_title", "department_id", "start_date", "contract_ends_on"], (
          <>
            <Field label="Job Title" {...f.field("job_title")}>
              <TextField {...f.field("job_title")} />
            </Field>
            <Field label="Department" {...f.field("department_id")}>
              <SelectField placeholder="Pick a department" options={departments} {...f.field("department_id")} />
            </Field>
            <Field label="Start Date" {...f.field("start_date")}>
              <DateField {...f.field("start_date")} />
            </Field>
            <Field label="Employment Type" {...f.field("employment_type")}>
              <SelectField options={EMPLOYMENT} {...f.field("employment_type")} />
            </Field>
            <Field label="Work Pattern" {...f.field("work_pattern")}>
              <SelectField options={PATTERN} {...f.field("work_pattern")} />
            </Field>
            <Field label="Contract Ends" optional {...f.field("contract_ends_on")}>
              <DateField {...f.field("contract_ends_on")} />
            </Field>
            <Field label="Probation Ends" optional {...f.field("confirmation_due_on")}>
              <DateField {...f.field("confirmation_due_on")} />
            </Field>
            <Field label="Line Manager" optional>
              <EmployeePicker value={manager} onChange={setManager} placeholder="Manager's name" />
            </Field>
          </>
        )),
        step("Pay and Next of Kin", ["gross_monthly", "account_number", "date_of_birth"], (
          <>
            <Field label="Gross Monthly" optional help="Open to Operations and People, Management, Implementation and the CEO." {...f.field("gross_monthly")}>
              <MoneyField {...f.field("gross_monthly")} />
            </Field>
            <Field label="Bank" optional {...f.field("bank_name")}>
              <TextField {...f.field("bank_name")} />
            </Field>
            <Field label="Account Number" optional {...f.field("account_number")}>
              <TextField inputMode="numeric" maxLength={10} {...f.field("account_number")} />
            </Field>
            <Field label="Date of Birth" optional {...f.field("date_of_birth")}>
              <DateField {...f.field("date_of_birth")} />
            </Field>
            <Field label="Next of Kin" optional {...f.field("next_of_kin_name")}>
              <TextField {...f.field("next_of_kin_name")} />
            </Field>
            <Field label="Next of Kin Phone" optional {...f.field("next_of_kin_phone")}>
              <PhoneField {...f.field("next_of_kin_phone")} />
            </Field>
          </>
        )),
      ]}
    />
  );
}

/** Edit: the record's own fields, checked by `EmployeeUpdate`. */
export function EditEmployee({ employee, close }: { employee: Employee360; close: () => void }) {
  const departments = useDepartments();
  const start = useMemo<Values>(
    () => ({
      ...blank,
      first_name: employee.first_name,
      middle_name: employee.middle_name ?? "",
      last_name: employee.last_name,
      work_email: employee.work_email,
      phone: employee.phone ?? "",
      job_title: employee.job_title,
      department_id: employee.department_id,
      employment_type: employee.employment_type,
      work_pattern: employee.work_pattern,
      start_date: employee.start_date ?? "",
      contract_ends_on: employee.contract_ends_on ?? "",
      confirmation_due_on: employee.confirmation_due_on ?? "",
      gender: employee.gender ?? "",
      date_of_birth: employee.date_of_birth ?? "",
      personal_email: employee.personal_email ?? "",
      home_address: employee.home_address ?? "",
      next_of_kin_name: employee.next_of_kin_name ?? "",
      next_of_kin_phone: employee.next_of_kin_phone ?? "",
      next_of_kin_relationship: employee.next_of_kin_relationship ?? "",
      bank_name: employee.bank_name ?? "",
      account_number: employee.account_number ?? "",
      gross_monthly: employee.gross_monthly ?? "",
    }),
    [employee],
  );
  const f = useContractForm<Values>(start, organisation.EmployeeUpdate);
  const save = useMutation("PATCH /api/v1/employees/:id");

  const submit = async () => {
    if (!f.check()) return;
    /* Only what the person changed: a field they may not see arrives masked, and sending
       it back as it looks on screen would blank it (the API refuses that too). */
    const changed = Object.fromEntries(
      (Object.keys(f.values) as Array<keyof Values>)
        .filter((k) => f.values[k] !== start[k])
        .map((k) => [k, f.values[k]]),
    );
    if (Object.keys(changed).length === 0) {
      close();
      return;
    }
    try {
      await save.run({ params: { id: employee.employee_id }, body: changed as never });
      invalidate("/api/v1/employees", "/api/v1/org-chart");
      close();
      toast(`${employee.display_name} saved`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };

  return (
    <Form onSubmit={() => submit()}>
      <Field label="First Name" {...f.field("first_name")}>
        <TextField {...f.field("first_name")} />
      </Field>
      <Field label="Last Name" {...f.field("last_name")}>
        <TextField {...f.field("last_name")} />
      </Field>
      <Field label="Work Email" {...f.field("work_email")}>
        <TextField type="email" {...f.field("work_email")} />
      </Field>
      <Field label="Phone" {...f.field("phone")}>
        <PhoneField {...f.field("phone")} />
      </Field>
      <Field label="Job Title" {...f.field("job_title")}>
        <TextField {...f.field("job_title")} />
      </Field>
      <Field label="Department" {...f.field("department_id")}>
        <SelectField options={departments} {...f.field("department_id")} />
      </Field>
      <Field label="Employment Type" {...f.field("employment_type")}>
        <SelectField options={EMPLOYMENT} {...f.field("employment_type")} />
      </Field>
      <Field label="Work Pattern" {...f.field("work_pattern")}>
        <SelectField options={PATTERN} {...f.field("work_pattern")} />
      </Field>
      <Field label="Probation Ends" optional {...f.field("confirmation_due_on")}>
        <DateField {...f.field("confirmation_due_on")} />
      </Field>
      <Field label="Contract Ends" optional {...f.field("contract_ends_on")}>
        <DateField {...f.field("contract_ends_on")} />
      </Field>
      <Field label="Gross Monthly" optional {...f.field("gross_monthly")}>
        <MoneyField {...f.field("gross_monthly")} />
      </Field>
      <Field label="Bank" optional {...f.field("bank_name")}>
        <TextField {...f.field("bank_name")} />
      </Field>
      <Field label="Account Number" optional {...f.field("account_number")}>
        <TextField inputMode="numeric" maxLength={10} {...f.field("account_number")} />
      </Field>
      {save.error && !Object.keys(save.fields).length && <FormError>{save.error.message}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.pending}>
          Save Record
        </Button>
      </FormFooter>
    </Form>
  );
}
