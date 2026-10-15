import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import type { EmployeeCreate, EmployeeRow } from "@/api/types/organisation";
import { useMe } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Bars, Pill, StatStrip, Who } from "@/components/ui/data";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Pager, Table, Toolbar } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { hrefFor, useRouter } from "@/lib/router";
import { EmployeeDetails } from "./EmployeeDetails";
import { DateField, Field, FilterSelect, MoneyField, PersonPicker, PhoneField, rules, SearchBox, SelectField, TextField, toMoneyString, UploadField, useContractForm, Wizard, type WizardStep } from "@/components/form";

export function Employees() {
  const me = useMe();
  const modal = useModal();
  const { navigate } = useRouter();
  const summary = useApi("GET /api/v1/employees/summary");
  const depts = usePaged("GET /api/v1/departments");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const list = usePaged("GET /api/v1/employees", { filters: { ...(department !== "all" && { department }), ...(status !== "all" && { status }) } });
  const canCreate = me.grants.people?.includes("create");
  const open = (r: EmployeeRow) => modal.open({ title: `Employee Details · ${r.display_name}`, wide: true, body: (close) => <EmployeeDetails id={r.employee_id} close={close} /> });

  return (
    <>
      <PageHead
        title="Employees"
        sub={summary.data ? `${summary.data.kpis[0].value} staff · ${summary.data.departments.length} departments` : " "}
        actions={
          canCreate && (
            <>
              <Button onClick={() => modal.open({ title: "Import Employees", body: <ImportStaff /> })}>Import</Button>
              <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Employee", wide: true, body: (close) => <AddEmployee close={close} /> })}>
                Add Employee
              </Button>
            </>
          )
        }
      />
      {summary.data && <KpiTiles items={summary.data.kpis} />}
      {summary.data && <StatStrip items={summary.data.arrangements.map((a) => ({ label: a.label, value: a.value }))} />}
      <Toolbar>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Name, title, number" className="w-full md:w-[300px]" />
        <FilterSelect label="Department" value={department} onChange={setDepartment} options={[["all", "All departments"], ...depts.rows.map((d) => [d.name, d.name] as [string, string])]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[["all", "Any status"], ["confirmed", "Active"], ["probation", "Probation"], ["on_leave", "On Leave"], ["suspended", "Suspended"]]} />
      </Toolbar>
      <Table
        title="All Employees"
        right={<span className="text-[11.5px] text-subtle-foreground max-md:hidden">Home addresses appear only in the authorised details view</span>}
        rows={list.rows}
        rowKey={(r) => r.employee_id}
        loading={list.loading}
        error={list.error}
        onRowClick={open}
        empty={{ icon: "srch", title: "Nobody Matches", text: "Clear the search or filters to see everyone." }}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.display_name} sub={r.department} /> },
          { key: "d", label: "Department", desktop: true, render: (r) => r.department },
          { key: "m", label: "Line Manager", desktop: true, render: (r) => r.line_manager?.display_name ?? "None" },
          { key: "a", label: "Arrangement", desktop: true, render: (r) => <Pill>{r.arrangement}</Pill> },
          { key: "t", label: "Attendance Today", render: (r) => <Pill tone={r.attendance_today.tone}>{r.attendance_today.text}</Pill> },
          { key: "s", label: "Employment Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
          { key: "x", label: "", desktop: true, render: (r) => <Button onClick={(e) => (e.stopPropagation(), open(r))}>View Details</Button> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="employee" />}
      />
      <Grid cols={2} className="mt-3">
        {summary.data && (
          <Card>
            <CardHeader title="Headcount by Department" />
            <Bars rows={summary.data.departments} />
          </Card>
        )}
        {summary.data && (
          <Card>
            <CardHeader title="Needs a Decision" right={<Pill tone="warn">{String(summary.data.decisions.length)}</Pill>} />
            {summary.data.decisions.map((d) => (
              <button key={d.title} type="button" onClick={() => navigate(d.link)} className="mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-2">
                <b className="block text-[12.5px] font-semibold">{d.title}</b>
                <span className="mb-1.5 block text-[11.5px] text-subtle-foreground">{d.text}</span>
                <Pill tone={d.action.tone}>{d.action.text}</Pill>
              </button>
            ))}
          </Card>
        )}
      </Grid>
    </>
  );
}

const EMPLOYMENT: Array<[EmployeeCreate["employment_type"], string]> = [["full_time", "Full time"], ["part_time", "Part time"], ["contractor", "Contractor"], ["consultant", "Consultant"], ["intern", "Intern"]];
const PATTERN: Array<[EmployeeCreate["work_pattern"], string]> = [["on_site", "On Site"], ["hybrid", "Hybrid"], ["remote", "Remote"]];

/** Add an employee: the contract's EmployeeCreate. No login without an employee record (CLAUDE.md). */
function AddEmployee({ close }: { close: () => void }) {
  const depts = usePaged("GET /api/v1/departments");
  const [manager, setManager] = useState<PersonRef[]>([]);
  const f = useContractForm(
    { first_name: "", last_name: "", work_email: "", phone: "", job_title: "", start_date: "", employment_type: "full_time", work_pattern: "hybrid", department_id: "", date_of_birth: "", next_of_kin: "", bank_name: "", account_number: "", gross_monthly: "" },
    {
      first_name: rules.required("Enter a first name"),
      last_name: rules.required("Enter a last name"),
      work_email: rules.email,
      phone: (v) => (/^0?\d{10}$/.test(v.replace(/\s/g, "")) ? null : "A Nigerian number"),
      job_title: rules.required("Enter a job title"),
      start_date: rules.required("Pick a start date"),
      department_id: rules.required("Pick a department"),
      account_number: (v) => (!v || /^\d{10}$/.test(v) ? null : "10 digits"),
      gross_monthly: (v) => (!v || rules.amount(v) == null ? null : "Numbers only"),
    },
  );
  const save = useMutation("POST /api/v1/employees");
  const { navigate } = useRouter();
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    const body: EmployeeCreate = {
      first_name: v.first_name.trim(), last_name: v.last_name.trim(), work_email: v.work_email.trim(), phone: `+234${v.phone.replace(/\s/g, "").replace(/^0/, "")}`, job_title: v.job_title.trim(), start_date: v.start_date,
      employment_type: v.employment_type as EmployeeCreate["employment_type"], work_pattern: v.work_pattern as EmployeeCreate["work_pattern"], department_id: v.department_id,
      ...(manager[0] && { line_manager_id: manager[0].employee_id }), ...(v.date_of_birth && { date_of_birth: v.date_of_birth }), ...(v.next_of_kin && { next_of_kin: v.next_of_kin }),
      ...(v.bank_name && { bank_name: v.bank_name }), ...(v.account_number && { account_number: v.account_number }), ...(v.gross_monthly && { gross_monthly: toMoneyString(v.gross_monthly) }),
    };
    try {
      const e = await save.run({ body });
      invalidate("/api/v1/employees");
      close();
      toast(`${e.display_name} added as ${e.staff_number}`);
      navigate(hrefFor("people", "employees", { id: e.employee_id }));
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  const step = (title: string, keys: Array<keyof typeof f.values>, body: React.ReactNode): WizardStep => ({ title, body, check: () => f.check(keys) });
  return (
    <Wizard
      finish="Add Employee"
      busy={save.pending}
      onFinish={() => void submit()}
      onCancel={close}
      steps={[
        step("Person", ["first_name", "last_name", "work_email", "phone"], (
          <>
            <Field label="First Name" {...f.field("first_name")}><TextField {...f.field("first_name")} autoComplete="off" /></Field>
            <Field label="Last Name" {...f.field("last_name")}><TextField {...f.field("last_name")} autoComplete="off" /></Field>
            <Field label="Work Email" {...f.field("work_email")}><TextField type="email" {...f.field("work_email")} placeholder="name@mycityapp.io" /></Field>
            <Field label="Phone" {...f.field("phone")}><PhoneField {...f.field("phone")} /></Field>
            <Field label="Date of Birth" optional info="For the birthday post in Staff Community. Never shown on a card."><DateField {...f.field("date_of_birth")} /></Field>
          </>
        )),
        step("Role", ["job_title", "department_id", "start_date"], (
          <>
            <Field label="Job Title" {...f.field("job_title")}><TextField {...f.field("job_title")} /></Field>
            <Field label="Department" {...f.field("department_id")}>
              <SelectField placeholder="Pick a department" options={depts.rows.map((d) => [d.department_id, d.name])} {...f.field("department_id")} />
            </Field>
            <Field label="Start Date" {...f.field("start_date")}><DateField {...f.field("start_date")} /></Field>
            <Field label="Employment Type"><SelectField options={EMPLOYMENT} {...f.field("employment_type")} /></Field>
            <Field label="Work Pattern"><SelectField options={PATTERN} {...f.field("work_pattern")} /></Field>
            <Field label="Line Manager" optional><PersonPicker value={manager} onChange={setManager} placeholder="Manager's name" /></Field>
          </>
        )),
        step("Pay and Bank", ["gross_monthly", "account_number"], (
          <>
            <Field label="Gross Monthly" optional info="Restricted: People, Payroll and the CEO see it." {...f.field("gross_monthly")}><MoneyField {...f.field("gross_monthly")} /></Field>
            <Field label="Bank" optional><TextField {...f.field("bank_name")} /></Field>
            <Field label="Account Number" optional {...f.field("account_number")}><TextField inputMode="numeric" maxLength={10} {...f.field("account_number")} /></Field>
            <Field label="Next of Kin" optional><TextField {...f.field("next_of_kin")} /></Field>
          </>
        )),
      ]}
    />
  );
}

/** The staff importer runs on the import engine (map, preview as a real run rolled back, commit). */
function ImportStaff() {
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Upload the staff sheet. Columns are mapped next, then a preview runs the import for real and rolls it back, so you see every error before anything is saved.</p>
      <UploadField purpose="import" accept=".xlsx,.csv" multiple={false} label="Drop the staff sheet here, or browse" onUploaded={() => toast("Sheet received. Map its columns to continue.")} />
    </>
  );
}
