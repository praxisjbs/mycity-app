/**
 * Performance · KPIs (docs/guides/performance.md §2, §3.6, §6.5, §10): each function's standing
 * operational measures and their monthly actuals, Met, Not Met or N/A. New KPI and Record Actual
 * for the function's head; a KPI opens its definition, its months and the lines that use it.
 */
import { useEffect, useRef, useState } from "react";
import kpisContract from "@mycity/contract/schemas/kpis.js";
import type { Endpoints, Kpi } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  DataView,
  ErrorState,
  Field,
  FilterSelect,
  formatDate,
  formatMonth,
  FormError,
  FormFooter,
  HelpTerm,
  KeyValue,
  LoadingRows,
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
import { bodySchema, figureOf, kpiResult, monthShort, person, reportingMonth, sayRefusal, UnitField, useQuarter, useSettableFunctions } from "./shared";

type KpiCreateBody = Endpoints["POST /api/v1/performance/kpis"]["body"];
type KpiActualBody = Endpoints["POST /api/v1/performance/kpis/:id/actuals"]["body"];
const say = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not save");
const RESULTS: Array<[string, string]> = [["met", "Met"], ["not_met", "Not Met"], ["na", "N/A"]];
const DIRECTIONS: Array<[string, string]> = [["higher", "Higher Is Better"], ["lower", "Lower Is Better"]];
const FREQUENCIES: Array<[string, string]> = [["monthly", "Monthly"], ["weekly", "Weekly"], ["quarterly", "Quarterly"]];
const naHelp = "No eligible cases this month. It never counts as met.";

export function Kpis() {
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
  // New KPI is offered only to a reader who may set some function's KPIs, as the API's goals.authority answers.
  const mayAdd = useSettableFunctions(null).rows.some((x) => x.department_id !== null);
  const newKpi = () => modal.open({ title: "New KPI", body: (close) => <KpiForm close={close} periodId={quarter.periodId} departmentId={dept} /> });
  const openKpiId = (id: string, code = "KPI") => modal.open({ title: code, wide: true, body: (close) => <KpiSheet id={id} months={months} close={close} /> });
  const openKpi = (k: Kpi) => openKpiId(k.kpi_definition_id, k.code);
  // A KPI found with ⌘K (or linked from elsewhere, `?id=`) opens its sheet once, then leaves the address.
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || opened.current === linked) return;
    opened.current = linked;
    setParams({ id: null }, { replace: true });
    openKpiId(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);
  useScreenAction(mayAdd ? { label: "New KPI", onSelect: newKpi } : null);

  return (
    <>
      <PageHeader
        title="KPIs"
        sub={period ? `${period.name} · ${formatDate(period.starts_on)} to ${formatDate(period.ends_on)}` : undefined}
        actions={mayAdd ? <Button variant="primary" icon="plus" onClick={newKpi}>New KPI</Button> : undefined}
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
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!k) return <LoadingRows count={4} />;
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

/**
 * New KPI: the functions the reader may set KPIs for, from the server (useSettableFunctions; a KPI
 * is always a function's, never the company's). The form opens once they are known, on the page's
 * Function when the reader sets it, else on their one function.
 */
function KpiForm({ close, periodId, departmentId }: { close: () => void; periodId: string; departmentId: string }) {
  const settable = useSettableFunctions(null);
  if (settable.error) return <ErrorState error={settable.error} onRetry={settable.reload} />;
  if (settable.loading) return <LoadingRows count={4} />;
  const options = settable.rows.flatMap((x) => (x.department_id ? [[x.department_id, x.name ?? ""] as [string, string]] : []));
  const first = options.some(([id]) => id === departmentId) ? departmentId : options.length === 1 ? options[0]![0] : "";
  return <KpiFields close={close} periodId={periodId} departmentId={first} options={options} />;
}

function KpiFields({ close, periodId, departmentId, options }: { close: () => void; periodId: string; departmentId: string; options: Array<[string, string]> }) {
  const f = useContractForm(
    { department_id: departmentId, name: "", formula: "", unit: "", direction: "higher", target_text: "", target_value: "", frequency: "monthly", data_source: "", starts_period_id: periodId },
    kpisContract.KpiCreate,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("POST /api/v1/performance/kpis");
  const none = options.length === 0;
  const submit = async () => {
    setProblem(null);
    if (none || !f.check()) return;
    try {
      const k = await save.run({ body: f.values as KpiCreateBody });
      invalidate("/api/v1/performance/kpis");
      close();
      toast(`${k.code} set`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Function" {...(none ? { state: "bad" as const, message: "None you may set" } : f.status("department_id"))}>
        <SelectField options={options} placeholder="Pick a function" {...f.field("department_id")} />
      </Field>
      <Field label="KPI" {...f.status("name")}><TextField {...f.field("name")} /></Field>
      <Field label="Formula" optional {...f.status("formula")}><TextField {...f.field("formula")} /></Field>
      <Field label="Unit" optional {...f.status("unit")}><UnitField {...f.field("unit")} /></Field>
      <Field label="Direction" {...f.status("direction")}><SelectField options={DIRECTIONS} {...f.field("direction")} /></Field>
      <Field label="Target" optional {...f.status("target_value")}><NumberField decimal signed {...f.field("target_value")} /></Field>
      <Field label="Target Wording" {...f.status("target_text")}><TextField {...f.field("target_text")} /></Field>
      <Field label="Frequency" {...f.status("frequency")}><SelectField options={FREQUENCIES} {...f.field("frequency")} /></Field>
      <Field label="Data Source" optional {...f.status("data_source")}><TextField {...f.field("data_source")} /></Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set KPI</Button>
      </FormFooter>
    </>
  );
}

type KpiEditValues = { name: string; formula: string; unit: string; target_text: string; data_source: string };
const or = (v: string) => (v.trim() === "" ? null : v.trim());
// The target's wording is sent as typed: the contract refuses it empty, and a KPI never loses it.
const kpiEditBody = (v: KpiEditValues) => ({ name: v.name, formula: or(v.formula), unit: or(v.unit), target_text: v.target_text, data_source: or(v.data_source) });

/** Edit KPI: the contract's KpiEdit checks each field as it is filled, and a refusal lands on its field. */
function KpiEditForm({ kpi, close }: { kpi: Kpi; close: () => void }) {
  const f = useContractForm<KpiEditValues>(
    { name: kpi.name, formula: kpi.formula ?? "", unit: kpi.unit ?? "", target_text: kpi.target_text ?? "", data_source: kpi.data_source ?? "" },
    bodySchema<KpiEditValues>(kpisContract.KpiEdit, kpiEditBody),
  );
  const save = useMutation("PATCH /api/v1/performance/kpis/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: kpi.kpi_definition_id }, body: kpiEditBody(f.values) });
      close();
      toast("KPI saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="KPI" {...f.status("name")}><TextField {...f.field("name")} /></Field>
      <Field label="Formula" optional {...f.status("formula")}><TextField {...f.field("formula")} /></Field>
      <Field label="Unit" optional {...f.status("unit")}><UnitField {...f.field("unit")} /></Field>
      <Field label="Target Wording" {...f.status("target_text")}><TextField {...f.field("target_text")} /></Field>
      <Field label="Data Source" optional {...f.status("data_source")}><TextField {...f.field("data_source")} /></Field>
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
  // A month with no eligible cases has no figure; Met and Not Met need one.
  const noCases = f.values.result === "na";
  const chooseResult = (result: string) => {
    f.set("result", result);
    if (result === "na") f.set("actual_value", "");
  };
  return (
    <>
      <Field label="Month" {...f.status("month")}><SelectField options={months.map((m) => [m, formatMonth(m)] as [string, string])} {...f.field("month")} /></Field>
      <Field label="Result" {...f.status("result")}><SelectField options={RESULTS} {...f.field("result")} onChange={chooseResult} /></Field>
      {!noCases && <Field label="Actual" {...f.status("actual_value")}><NumberField decimal signed {...f.field("actual_value")} /></Field>}
      <Field label="Comment" optional {...f.status("comment")}><TextField {...f.field("comment")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Record Actual</Button>
      </FormFooter>
    </>
  );
}
