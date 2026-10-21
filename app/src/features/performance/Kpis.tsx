import { useState } from "react";
import kpis from "@mycity/contract/schemas/kpis.js";
import type { EmployeeKpis, Kpi, KpiAssignItem } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { PagedTable } from "@/features/shared/sections";
import { EmployeePicker } from "@/features/shared/pickers";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  cn,
  DataView,
  ErrorState,
  Field,
  FilterSelect,
  FormFooter,
  formatMonth,
  Grid,
  IconButton,
  KpiCard,
  LoadingRows,
  Meter,
  NumberField,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  toast,
  todayIso,
  Toolbar,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { kpiStatus, percent, progressStatus } from "./status";

/**
 * Performance · KPIs (#31; docs/guides/performance.md §10): each person's monthly KPIs and
 * weights, set by their line manager or head under their department's targets, bound when the
 * department's month is approved, and their progress from tasks or entered by hand.
 */
const WEIGHTS_HELP = "Each person's KPIs add up to 100%.";

export function Kpis() {
  const me = useMe();
  const modal = useModal();
  const month = todayIso().slice(0, 7);
  const [dept, setDept] = useState("");
  const depts = useApi("GET /api/v1/departments", { query: {} });
  const s = useApi("GET /api/v1/performance/kpis/summary", { query: dept ? { month, department_id: dept } : { month } });
  const list = usePaged("GET /api/v1/performance/kpis", { filters: dept ? { month, department_id: dept } : { month } });
  const [who, setWho] = useState<PersonRef | null>(null);
  const shown = who ?? list.rows[0]?.employee ?? null;
  const canAssign = hasCapability(me, "kpis.assign");
  const assign = (p?: PersonRef) => modal.open({ title: "Assign KPIs", wide: true, full: true, body: (close) => <AssignKpis close={close} month={month} initial={p} /> });
  const record = (k: Kpi) => modal.open({ title: "Record Figure", body: (close) => <ActualForm close={close} kpi={k} /> });
  useScreenAction(canAssign ? { label: "Assign KPIs", onSelect: () => assign() } : null);

  return (
    <>
      <PageHeader title="KPIs" sub={formatMonth(month)} actions={canAssign && <Button variant="primary" icon="plus" onClick={() => assign()}>Assign KPIs</Button>} />
      {s.data && (
        <Grid cols="4m2">
          <KpiCard title="Staff With KPIs" value={`${s.data.with_kpis} of ${s.data.staff}`} />
          <KpiCard title="Weights" help={WEIGHTS_HELP} value={s.data.weights_off ? `${s.data.weights_off} off` : "All 100%"} tone={s.data.weights_off ? "err" : "ok"} />
          <KpiCard title="On Track" value={String(s.data.on_track)} tone="ok" />
          <KpiCard title="Behind or At Risk" value={String(s.data.behind_or_at_risk)} tone={s.data.behind_or_at_risk ? "warn" : undefined} />
        </Grid>
      )}
      <Toolbar>
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[["", "All Departments"], ...(depts.data?.data ?? []).map((d) => [d.department_id, d.name] as [string, string])]} />
      </Toolbar>
      <PagedTable<Kpi>
        title="This Month"
        list={list}
        search="Search people or KPIs"
        rowKey={(k) => k.employee_target_id}
        onRowClick={(k) => (k.can_record_actual ? record(k) : setWho(k.employee))}
        noun="KPI"
        columns={[
          { key: "emp", label: "Employee", render: (k) => <Who name={k.employee.display_name} sub={k.employee.department ?? undefined} /> },
          { key: "kpi", label: "KPI", render: (k) => k.title },
          { key: "w", label: "Weight", align: "n", render: (k) => `${Number(k.weight)}%` },
          { key: "p", label: "Progress", align: "n", render: (k) => (k.actual_value === null ? percent(k.attainment) : `${k.actual_value} of ${k.target_value}${k.unit ? ` ${k.unit}` : ""}`) },
          { key: "by", label: "Set By", desktop: true, render: (k) => k.set_by?.display_name },
          { key: "s", label: "Status", render: (k) => <StatusPill s={k.attainment === null ? kpiStatus(k.status) : progressStatus(k.progress_status)} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {shown ? <WeightsCard person={shown} month={month} onEdit={canAssign ? () => assign(shown) : undefined} /> : <Card><LoadingRows /></Card>}
        <div className="max-md:hidden">
          <DataView
            title="Progress Sources"
            rows={s.data?.sources ?? []}
            rowKey={(r) => r.progress_source}
            loading={s.loading}
            columns={[
              { key: "l", label: "Source", render: (r) => (r.progress_source === "tasks" ? "Done Tasks" : "Entered by Hand") },
              { key: "c", label: "KPIs", align: "n", render: (r) => r.count },
            ]}
          />
        </div>
      </Grid>
    </>
  );
}

function WeightsCard({ person, month, onEdit }: { person: PersonRef; month: string; onEdit?: () => void }) {
  const k = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: person.employee_id }, query: { month } });
  if (k.error) return <ErrorState error={k.error} onRetry={k.reload} />;
  const d = k.data;
  const whole = d?.total_weight === "100.00";
  return (
    <Card>
      <CardHeader title="Weights" help={WEIGHTS_HELP} right={d && <StatusPill s={whole ? { tone: "ok", text: "100%" } : { tone: "err", text: `${Number(d.total_weight)}%` }} />} />
      <p className="mb-2 text-xs font-semibold">{person.display_name}</p>
      {!d ? (
        <LoadingRows />
      ) : (
        d.items.map((r) => (
          <div key={r.employee_target_id} className="flex items-center gap-2.5 py-1.5">
            <span className="flex-1 text-xs">{r.title}</span>
            <span className="w-36 flex-none"><Meter pct={Number(r.weight)} label={`${Number(r.weight)}%`} /></span>
          </div>
        ))
      )}
      <div className="mt-1 flex gap-2.5 border-t-2 border-border pt-2">
        <b className="flex-1 text-xs">Total</b>
        <b className={cn("text-xs", whole ? "text-success" : "text-destructive")}>{d ? `${Number(d.total_weight)}%` : ""}</b>
      </div>
      {onEdit && d?.can_assign && <Button size="sm" className="mt-2" onClick={onEdit}>Edit Weights</Button>}
    </Card>
  );
}

type Row = { employee_target_id?: string; organisational_goal_id: string; title: string; target_value: string; unit: string; progress_source: "manual" | "tasks"; weight: string };
const blankRow = (target = ""): Row => ({ organisational_goal_id: target, title: "", target_value: "", unit: "", progress_source: "tasks", weight: "" });
const rowsOf = (d: EmployeeKpis): Row[] =>
  d.items.map((i) => ({
    employee_target_id: i.employee_target_id,
    organisational_goal_id: i.target?.organisational_goal_id ?? "",
    title: i.title,
    target_value: i.target_value ?? "",
    unit: i.unit ?? "",
    progress_source: i.progress_source,
    weight: String(Number(i.weight)),
  }));

/** Assign KPIs: a person, then each KPI with its target, figure, source and weight. */
function AssignKpis({ close, month, initial }: { close: () => void; month: string; initial?: PersonRef }) {
  const [who, setWho] = useState<PersonRef[]>(initial ? [initial] : []);
  const person = who[0];
  const existing = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: person?.employee_id ?? "" }, query: { month }, enabled: !!person });
  const [edited, setEdited] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const targets = existing.data?.targets ?? [];
  const rows = edited ?? (existing.data ? (existing.data.items.length ? rowsOf(existing.data) : [blankRow(targets[0]?.organisational_goal_id)]) : []);
  const total = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const save = useMutation("PUT /api/v1/performance/kpis/employees/:id");
  const set = (i: number, patch: Partial<Row>) => setEdited(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!person) return setErrors({ employee: "Pick the employee" });
    const body = {
      month,
      items: rows.map((r): KpiAssignItem => ({
        ...(r.employee_target_id ? { employee_target_id: r.employee_target_id } : {}),
        organisational_goal_id: r.organisational_goal_id,
        title: r.title,
        target_value: r.target_value,
        unit: r.unit || undefined,
        direction: "higher",
        progress_source: r.progress_source,
        weight: r.weight,
      })),
    };
    const parsed = kpis.KpiAssign.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((x) => [x.path.join("."), x.message])));
      return;
    }
    setErrors({});
    try {
      await save.run({ params: { id: person.employee_id }, body });
      invalidate("/api/v1/performance/kpis");
      close();
      toast(`KPIs saved for ${person.display_name}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, v[0]])));
      else if (e instanceof ApiError) toast(e.message);
    }
  };
  const err = (i: number, k: string) => errors[`items.${i}.${k}`];

  return (
    <>
      <Field label="Employee" state={errors.employee ? "bad" : undefined} message={errors.employee}>
        <EmployeePicker value={who} onChange={(v) => (setWho(v), setEdited(null), setErrors({}))} />
      </Field>
      {person && existing.loading && <LoadingRows />}
      {person && existing.data && !existing.data.can_assign && <p className="text-xs text-muted-foreground">This month is already sent.</p>}
      {person && existing.data?.can_assign && (
        <>
          {rows.map((r, i) => (
            <Card key={r.employee_target_id ?? `new-${i}`} className="mb-2">
              <CardHeader title={`KPI ${i + 1}`} level={3} right={rows.length > 1 && <IconButton icon="x" label={`Remove KPI ${i + 1}`} onClick={() => setEdited(rows.filter((_, j) => j !== i))} />} />
              <Field label="KPI" state={err(i, "title") ? "bad" : undefined} message={err(i, "title")}>
                <TextField value={r.title} onChange={(v) => set(i, { title: v })} placeholder="Sessions delivered" />
              </Field>
              <Field label="Rolls Up To" state={err(i, "organisational_goal_id") ? "bad" : undefined} message={err(i, "organisational_goal_id")}>
                <SelectField value={r.organisational_goal_id} onChange={(v) => set(i, { organisational_goal_id: v })} placeholder="Department target" options={targets.map((t) => [t.organisational_goal_id, t.title])} />
              </Field>
              <Grid cols={3}>
                <Field label="Target" state={err(i, "target_value") ? "bad" : undefined} message={err(i, "target_value")}>
                  <NumberField decimal value={r.target_value} onChange={(v) => set(i, { target_value: v })} />
                </Field>
                <Field label="Unit" optional>
                  <TextField value={r.unit} onChange={(v) => set(i, { unit: v })} placeholder="sessions" />
                </Field>
                <Field label="Weight" state={err(i, "weight") ? "bad" : undefined} message={err(i, "weight")}>
                  <NumberField decimal value={r.weight} onChange={(v) => set(i, { weight: v })} />
                </Field>
              </Grid>
              <Field label="Progress From">
                <ChoiceField value={r.progress_source} onChange={(v) => set(i, { progress_source: v })} options={[["tasks", "From Tasks"], ["manual", "By Hand"]]} />
              </Field>
            </Card>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" icon="plus" onClick={() => setEdited([...rows, blankRow(targets[0]?.organisational_goal_id)])}>Add KPI</Button>
            <b className={cn("text-xs", total === 100 ? "text-success" : "text-destructive")}>{`Total ${total}%`}</b>
          </div>
        </>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save KPIs</Button>
      </FormFooter>
    </>
  );
}

/** A manual KPI's figure so far, by the person or whoever set it. */
function ActualForm({ close, kpi }: { close: () => void; kpi: Kpi }) {
  const f = useContractForm({ actual_value: kpi.actual_value ?? "", note: "" }, kpis.KpiActual);
  const save = useMutation("POST /api/v1/performance/kpis/:id/actual");
  const submit = f.submit(async (v) => {
    try {
      await save.run({ params: { id: kpi.employee_target_id }, body: v });
      invalidate("/api/v1/performance/kpis");
      close();
      toast("Figure recorded");
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else if (e instanceof ApiError) toast(e.message);
    }
  });
  return (
    <>
      <p className="mb-3 text-xs font-semibold">{kpi.title}</p>
      <Field label={`So Far, of ${kpi.target_value}`} {...f.status("actual_value")}>
        <NumberField decimal {...f.field("actual_value")} />
      </Field>
      <Field label="Note" optional {...f.status("note")}>
        <TextField {...f.field("note")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Record Figure</Button>
      </FormFooter>
    </>
  );
}
