/**
 * Performance · KPIs (docs/guides/performance.md §2, §3.6, §6.5, §10): each function's standing
 * operational measures and their monthly actuals, Met, Not Met or N/A. New KPI and Record Actual
 * for the function's head; a KPI opens its definition, its months and the lines that use it.
 */
import { useState } from "react";
import kpisContract from "@mycity/contract/schemas/kpis.js";
import type { Endpoints, Kpi } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  DataView,
  Field,
  FilterSelect,
  formatDate,
  formatMonth,
  FormFooter,
  HelpTerm,
  KeyValue,
  NumberField,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { figureOf, kpiResult, monthShort, person, reportingMonth, useQuarter } from "./shared";

type KpiCreateBody = Endpoints["POST /api/v1/performance/kpis"]["body"];
type KpiActualBody = Endpoints["POST /api/v1/performance/kpis/:id/actuals"]["body"];
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const RESULTS: Array<[string, string]> = [["met", "Met"], ["not_met", "Not Met"], ["na", "N/A"]];
const DIRECTIONS: Array<[string, string]> = [["higher", "Higher Is Better"], ["lower", "Lower Is Better"]];
const FREQUENCIES: Array<[string, string]> = [["monthly", "Monthly"], ["weekly", "Weekly"], ["quarterly", "Quarterly"]];
const naHelp = "No eligible cases this month. It never counts as met.";

export function Kpis() {
  const me = useMe();
  const modal = useModal();
  const quarter = useQuarter();
  const period = quarter.period;
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const [dept, setDept] = useState("");
  const list = usePaged("GET /api/v1/performance/kpis", { filters: { active: "true", ...(dept ? { department_id: dept } : {}) } });
  const months = period?.months ?? [];
  // The month just ended, which the heads and the workbook import record.
  const last = reportingMonth(months);
  const summary = useApi("GET /api/v1/performance/kpis/summary", { query: { ...(dept ? { department_id: dept } : {}), month: last }, enabled: Boolean(last) });
  const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const tiles = [
    { label: "KPIs", value: counted(summary.data?.kpis) },
    { label: "Met Last Month", value: counted(summary.data?.met), tone: "ok" as const },
    { label: "Not Met", value: counted(summary.data?.not_met), tone: "err" as const },
    { label: "Awaiting Actual", value: counted(summary.data?.awaiting) },
  ];
  const deptOptions: Array<[string, string]> = [["", "All Functions"], ...(departments.data?.data ?? []).filter((d) => d.active).map((d) => [d.department_id, d.name] as [string, string])];
  const mayEdit = hasCapability(me, "goals.function");
  const newKpi = () => modal.open({ title: "New KPI", body: (close) => <KpiForm close={close} periodId={quarter.periodId} departmentId={dept} /> });
  const openKpi = (k: Kpi) => modal.open({ title: k.code, wide: true, body: (close) => <KpiSheet id={k.kpi_definition_id} months={months} close={close} /> });
  useScreenAction(mayEdit ? { label: "New KPI", onSelect: newKpi } : null);

  return (
    <>
      <PageHeader
        title="KPIs"
        sub={period ? `${period.name} · ${formatDate(period.starts_on)} to ${formatDate(period.ends_on)}` : undefined}
        actions={mayEdit ? <Button variant="primary" icon="plus" onClick={newKpi}>New KPI</Button> : undefined}
      />
      <Toolbar>
        <FilterSelect label="Function" value={dept} onChange={setDept} options={deptOptions} />
      </Toolbar>
      <KpiTiles items={tiles} mobileCols={2} />
      <PagedTable
        title="KPIs"
        list={list}
        search="Search KPIs"
        rowKey={(k) => k.kpi_definition_id}
        noun="KPI"
        onRowClick={openKpi}
        empty={{ title: "No KPIs Yet" }}
        columns={[
          { key: "code", label: "KPI ID", render: (k) => <span className="font-semibold">{k.code}</span> },
          { key: "name", label: "KPI", render: (k) => k.name },
          { key: "dept", label: "Function", render: (k) => k.department ?? "–", desktop: true },
          { key: "target", label: "Target", render: (k) => figureOf(k.target_value, k.target_text, k.unit) ?? "–", desktop: true },
          { key: "direction", label: "Direction", render: (k) => (k.direction === "lower" ? "Lower" : "Higher"), desktop: true },
          {
            key: "latest",
            label: <HelpTerm help={naHelp}>Latest</HelpTerm>,
            render: (k) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusPill s={kpiResult(k.latest?.result)} />
                {figureOf(k.latest?.actual_value, k.latest?.actual_text, k.unit) ?? ""}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

/** A KPI: its definition, the months with their actuals, and the scorecard lines that use it. */
function KpiSheet({ id, months, close }: { id: string; months: string[]; close: () => void }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/performance/kpis/:id", { params: { id } });
  const k = read.data;
  if (!k) return null;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/performance/kpis");
  };
  const mayEdit = k.can_edit;
  return (
    <>
      <KeyValue
        items={[
          ["KPI", k.name],
          ["Function", k.department ?? "–"],
          ["Formula", k.formula ?? "–"],
          ["Unit", k.unit ?? "–"],
          ["Direction", k.direction === "lower" ? "Lower Is Better" : "Higher Is Better"],
          ["Target", figureOf(k.target_value, k.target_text, k.unit) ?? "–"],
          ["Frequency", FREQUENCIES.find(([v]) => v === k.frequency)?.[1] ?? "–"],
          ["Data Source", k.data_source ?? "–"],
        ]}
      />
      <DataView
        className="mt-3"
        title="Months"
        rows={k.months}
        rowKey={(m) => m.kpi_month_id}
        empty={{ title: "No Actuals Yet" }}
        columns={[
          { key: "month", label: "Month", render: (m) => monthShort(m.month) },
          { key: "result", label: <HelpTerm help={naHelp}>Result</HelpTerm>, render: (m) => <StatusPill s={kpiResult(m.result)} /> },
          { key: "actual", label: "Actual", align: "n", render: (m) => figureOf(m.actual_value, m.actual_text, k.unit) ?? "–" },
          { key: "comment", label: "Comment", render: (m) => m.comment ?? "–", desktop: true },
        ]}
      />
      {k.lines.length > 0 && (
        <DataView
          className="mt-3"
          title="Lines Using It"
          rows={k.lines}
          rowKey={(l) => l.employee_target_id}
          columns={[
            { key: "who", label: "Employee", render: (l) => person(l.employee) },
            { key: "line", label: "Line", render: (l) => l.title },
            { key: "weight", label: "Weight", align: "n", render: (l) => `${l.weight}%` },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {mayEdit && <Button onClick={() => modal.open({ title: "Edit KPI", body: (done) => <KpiEditForm kpi={k} close={() => (done(), reload())} /> })}>Edit KPI</Button>}
        {mayEdit && (
          <Button variant="primary" onClick={() => modal.open({ title: "Record Actual", body: (done) => <ActualForm id={id} months={months} close={() => (done(), reload())} /> })}>
            Record Actual
          </Button>
        )}
      </FormFooter>
    </>
  );
}

function KpiForm({ close, periodId, departmentId }: { close: () => void; periodId: string; departmentId: string }) {
  const departments = useApi("GET /api/v1/departments", { query: { active: "true" } });
  const f = useContractForm(
    { department_id: departmentId, name: "", formula: "", unit: "", direction: "higher", target_text: "", target_value: "", frequency: "monthly", data_source: "", starts_period_id: periodId },
    kpisContract.KpiCreate,
  );
  const save = useMutation("POST /api/v1/performance/kpis");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const k = await save.run({ body: f.values as KpiCreateBody });
      invalidate("/api/v1/performance/kpis");
      close();
      toast(`${k.code} set`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Function" {...f.status("department_id")}>
        <SelectField options={(departments.data?.data ?? []).map((d) => [d.department_id, d.name] as [string, string])} {...f.field("department_id")} />
      </Field>
      <Field label="KPI" {...f.status("name")}><TextField {...f.field("name")} /></Field>
      <Field label="Formula" optional {...f.status("formula")}><TextField {...f.field("formula")} /></Field>
      <Field label="Unit" optional {...f.status("unit")}><TextField {...f.field("unit")} /></Field>
      <Field label="Direction" {...f.status("direction")}><SelectField options={DIRECTIONS} {...f.field("direction")} /></Field>
      <Field label="Target" optional {...f.status("target_value")}><NumberField decimal signed {...f.field("target_value")} /></Field>
      <Field label="Target Wording" optional {...f.status("target_text")}><TextField {...f.field("target_text")} /></Field>
      <Field label="Frequency" {...f.status("frequency")}><SelectField options={FREQUENCIES} {...f.field("frequency")} /></Field>
      <Field label="Data Source" optional {...f.status("data_source")}><TextField {...f.field("data_source")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set KPI</Button>
      </FormFooter>
    </>
  );
}

function KpiEditForm({ kpi, close }: { kpi: Kpi; close: () => void }) {
  const [values, setValues] = useState({ name: kpi.name, formula: kpi.formula ?? "", unit: kpi.unit ?? "", target_text: kpi.target_text ?? "", data_source: kpi.data_source ?? "" });
  const save = useMutation("PATCH /api/v1/performance/kpis/:id");
  const set = (key: keyof typeof values) => (v: string) => setValues((x) => ({ ...x, [key]: v }));
  const submit = async () => {
    try {
      await save.run({
        params: { id: kpi.kpi_definition_id },
        body: { name: values.name, formula: values.formula || null, unit: values.unit || null, target_text: values.target_text || null, data_source: values.data_source || null },
      });
      close();
      toast("KPI saved");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="KPI" state={save.fields.name ? "bad" : undefined} message={save.fields.name?.[0]}><TextField value={values.name} onChange={set("name")} /></Field>
      <Field label="Formula" optional><TextField value={values.formula} onChange={set("formula")} /></Field>
      <Field label="Unit" optional><TextField value={values.unit} onChange={set("unit")} /></Field>
      <Field label="Target Wording" optional><TextField value={values.target_text} onChange={set("target_text")} /></Field>
      <Field label="Data Source" optional><TextField value={values.data_source} onChange={set("data_source")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save KPI</Button>
      </FormFooter>
    </>
  );
}

function ActualForm({ id, months, close }: { id: string; months: string[]; close: () => void }) {
  const f = useContractForm({ month: reportingMonth(months), result: "met", actual_value: "", comment: "" }, kpisContract.KpiActual);
  const save = useMutation("POST /api/v1/performance/kpis/:id/actuals");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values as KpiActualBody });
      close();
      toast("Actual recorded");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Month" {...f.status("month")}><SelectField options={months.map((m) => [m, formatMonth(m)] as [string, string])} {...f.field("month")} /></Field>
      <Field label="Result" {...f.status("result")}><SelectField options={RESULTS} {...f.field("result")} /></Field>
      <Field label="Actual" optional {...f.status("actual_value")}><NumberField decimal signed {...f.field("actual_value")} /></Field>
      <Field label="Comment" optional {...f.status("comment")}><TextField {...f.field("comment")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Record Actual</Button>
      </FormFooter>
    </>
  );
}
