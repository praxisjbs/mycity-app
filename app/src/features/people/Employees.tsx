import { useState } from "react";
import { usePhotos } from "@/api/download";
import { useApi, usePaged } from "@/api/hooks";
import type { EmployeeRow } from "@/api/types/organisation";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { toBars } from "@/features/shared/wire";
import { hrefFor, useRouter } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  FilterSelect,
  Grid,
  HelpTerm,
  PageHeader,
  Pill,
  SearchInput,
  StatStrip,
  Toolbar,
  Who,
  useModal,
} from "@mycity/ui";
import { AddEmployee } from "./EmployeeForm";
import { employmentStatus, INVITED_HELP, loginStatus, workPattern } from "./status";

/**
 * People · Employees (#24): the staff register (docs/guides/foundation.md §10).
 *
 * The server pages, searches, filters and sorts (25 a row, F20); nothing here slices
 * rows. A row opens that person's record. Import Staff opens the Import wizard on
 * Settings · Imports, already set to the employees importer.
 */
export function Employees() {
  const me = useMe();
  const modal = useModal();
  const { navigate } = useRouter();
  const summary = useApi("GET /api/v1/employees/summary");
  const departments = usePaged("GET /api/v1/departments");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [pattern, setPattern] = useState("");
  const list = usePaged("GET /api/v1/employees", {
    filters: {
      ...(department && { department_id: department }),
      ...(status && { status }),
      ...(pattern && { work_pattern: pattern }),
    },
  });
  const photo = usePhotos(list.rows.map((r) => r.photo_url));
  const canCreate = me.grants.people?.includes("create");
  const open = (r: EmployeeRow) => navigate(hrefFor("people", "employees", { id: r.employee_id }));
  const add = () => modal.open({ title: "Add Employee", wide: true, body: (close) => <AddEmployee close={close} /> });
  useScreenAction(canCreate ? { label: "Add Employee", onSelect: add } : null);
  // The assistant's Add Employee button: ?new=1 and the names and job (docs/guides/praxis-ai.md §6.4).
  useNewLink(canCreate ? add : null);

  return (
    <>
      <PageHeader
        title="Employees"
        sub={summary.data ? `${summary.data.kpis[0].value} staff · ${summary.data.departments.length} departments` : " "}
        actions={
          canCreate && (
            <>
              <Button icon="rows" onClick={() => navigate(hrefFor("settings", "imports", { importer: "employees" }))}>
                Import Staff
              </Button>
              <Button variant="primary" icon="plus" onClick={add}>
                Add Employee
              </Button>
            </>
          )
        }
      />
      {summary.data && <KpiTiles items={summary.data.kpis} />}
      {summary.data && <StatStrip items={summary.data.arrangements} />}
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Name, title, number" className="w-full md:w-72" />
        <FilterSelect
          label="Department"
          value={department}
          onChange={setDepartment}
          options={[["", "All Departments"], ...departments.rows.map((d) => [d.department_id, d.name] as [string, string])]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ["", "Any Status"],
            ["active", "Active"],
            ["suspended", "Suspended"],
            ["left", "Left"],
            ["archived", "Archived"],
          ]}
        />
        <FilterSelect
          label="Work Pattern"
          value={pattern}
          onChange={setPattern}
          options={[
            ["", "Any Pattern"],
            ["on_site", "On Site"],
            ["hybrid", "Hybrid"],
            ["remote", "Remote"],
          ]}
        />
      </Toolbar>
      <DataView
        title="All Employees"
        list={list}
        rowKey={(r) => r.employee_id}
        onRowClick={open}
        empty={{ icon: "srch", title: "Nobody Matches", text: "Clear the search or filters." }}
        columns={[
          { key: "display_name", label: "Employee", sortable: true, render: (r) => <Who name={r.display_name} sub={r.job_title} src={photo(r.photo_url)} /> },
          { key: "staff_number", label: "Number", sortable: true, desktop: true, render: (r) => r.staff_number },
          { key: "department", label: "Department", sortable: true, desktop: true, render: (r) => r.department },
          { key: "m", label: "Line Manager", desktop: true, render: (r) => (r.line_manager ? r.line_manager.display_name : "None") },
          { key: "p", label: "Work Pattern", desktop: true, render: (r) => <Pill>{workPattern(r.work_pattern)}</Pill> },
          { key: "s", label: "Status", render: (r) => <Pill tone={employmentStatus(r).tone}>{employmentStatus(r).text}</Pill> },
          {
            key: "l",
            label: "Login",
            render: (r) =>
              r.login === "invited" ? (
                <Pill tone="info">
                  <HelpTerm help={INVITED_HELP}>Invited</HelpTerm>
                </Pill>
              ) : (
                <Pill tone={loginStatus(r.login).tone}>{loginStatus(r.login).text}</Pill>
              ),
          },
          { key: "x", label: "", desktop: true, render: (r) => <Button onClick={(e) => (e.stopPropagation(), open(r))}>View Record</Button> },
        ]}
        noun="employee"
      />
      <Grid cols={2} className="mt-3">
        {summary.data && (
          <Card>
            <CardHeader title="Headcount by Department" />
            <Bars rows={toBars(summary.data.departments)} />
          </Card>
        )}
        {summary.data && summary.data.decisions.length > 0 && (
          <Card>
            <CardHeader title="Needs a Decision" right={<Pill tone="warn">{String(summary.data.decisions.length)}</Pill>} />
            {summary.data.decisions.map((d) => (
              <button
                key={d.title}
                type="button"
                onClick={() => navigate(d.link)}
                className="mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-2"
              >
                <b className="block text-xs font-semibold" data-ui="title">
                  {d.title}
                </b>
                <span className="mb-1.5 block text-2xs text-subtle-foreground">{d.text}</span>
                <Pill tone={d.action.tone}>{d.action.text}</Pill>
              </button>
            ))}
          </Card>
        )}
      </Grid>
    </>
  );
}
