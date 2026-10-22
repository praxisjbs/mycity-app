/**
 * Performance · KPIs: the interim screen, on the in-browser mock until its pull request lands.
 * PR 2 replaces this with a function's KPIs and their monthly actuals, against the contract.
 */
import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { KpiAssignment } from "@/api/types/performance";
import type { PersonRef } from "@/api/types/common";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable, useDepartmentOptions } from "@/features/shared/sections";
import { Button, Card, CardHeader, cn, DataView, Field, FilterSelect, FormFooter, Grid, Icon, LoadingRows, Meter, PageHeader, StatusPill, TextField, toast, Toolbar, useModal } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";
import { person } from "./shared";

export function Kpis() {
  const modal = useModal();
  const [dept, setDept] = useState("");
  const depts = useDepartmentOptions();
  const s = useApi("GET /api/v1/performance/kpis/summary");
  const list = usePaged("GET /api/v1/performance/kpis", { filters: dept ? { department: dept } : {} });
  const [who, setWho] = useState<PersonRef | null>(null);
  const shown = who ?? list.rows.find((r) => r.employee.display_name.startsWith("Chidera"))?.employee ?? list.rows[0]?.employee ?? null;
  const assign = (p?: PersonRef) => modal.open({ title: "Assign KPIs", body: (close) => <AssignKpis close={close} initial={p} /> });
  return (
    <>
      <PageHeader title="KPIs" sub="Individual monthly KPIs · set by department managers" actions={<Button variant="primary" icon="plus" onClick={() => assign()}>Assign KPIs</Button>} />
      {s.data && <KpiTiles items={[{ label: "Staff With KPIs", value: `${s.data.with_kpis} / ${s.data.staff}` }, { label: "Weights", value: s.data.weights_valid ? "100%" : "Check", tone: s.data.weights_valid ? "ok" : "err" }, { label: "On Track", value: String(s.data.on_track), tone: "ok" }, { label: "Behind or At Risk", value: String(s.data.behind), tone: "warn" }]} />}
      <Toolbar>
        <FilterSelect label="Department" value={dept} onChange={setDept} options={depts} />
      </Toolbar>
      <PagedTable<KpiAssignment>
        title="This Month"
        list={list}
        search="Search people or KPIs"
        rowKey={(k) => k.kpi_id}
        noun="KPI"
        onRowClick={(k) => setWho(k.employee)}
        columns={[
          { key: "emp", label: "Employee", render: (k) => person(k.employee) },
          { key: "kpi", label: "KPI", render: (k) => k.title },
          { key: "w", label: "Weight", align: "n", render: (k) => `${k.weight_pct}%` },
          { key: "p", label: "Progress", align: "n", render: (k) => k.progress, desktop: true },
          { key: "by", label: "Set By", render: (k) => k.set_by.display_name, desktop: true },
          { key: "s", label: "Status", render: (k) => <StatusPill s={k.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {shown ? <WeightsCard p={shown} onEdit={() => assign(shown)} /> : <Card><LoadingRows /></Card>}
        <DataView
          title="KPI Sources"
          rows={s.data?.sources ?? []}
          rowKey={(r) => r.label}
          loading={s.loading}
          columns={[{ key: "l", label: "Where Progress Comes From", render: (r) => r.label }, { key: "c", label: "Counts", align: "n", render: (r) => r.count }]}
        />
      </Grid>
    </>
  );
}

function WeightsCard({ p, onEdit }: { p: PersonRef; onEdit: () => void }) {
  const k = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: p.employee_id } });
  const ok = k.data?.total_pct === 100;
  return (
    <Card>
      <CardHeader title="Weights Must Total 100%" right={k.data && <StatusPill s={ok ? { tone: "ok", text: "All valid" } : { tone: "err", text: `${k.data.total_pct}%` }} />} />
      <p className="mb-2.5 text-2xs text-subtle-foreground">{p.display_name}, {k.data ? `${k.data.items.length} KPI${k.data.items.length === 1 ? "" : "s"} this month` : "loading"}.</p>
      {k.data?.items.map((r) => (
        <div key={r.kpi_id} className="flex items-center gap-2.5 py-1.5">
          <span className="flex-1 text-xs">{r.title}</span>
          <span className="w-36 flex-none"><Meter pct={Math.min(100, r.weight_pct * 2.5)} label={`${r.weight_pct}%`} /></span>
        </div>
      ))}
      <div className="mt-1 flex gap-2.5 border-t-2 border-border pt-2">
        <b className="flex-1 text-xs">Total</b>
        <b className={cn("text-xs", ok ? "text-success" : "text-destructive")}>{k.data?.total_pct ?? 0}%</b>
      </div>
      <Button size="sm" className="mt-2" onClick={onEdit}>Edit Weights</Button>
    </Card>
  );
}

function AssignKpis({ close, initial }: { close: () => void; initial?: PersonRef }) {
  const [who, setWho] = useState<PersonRef[]>(initial ? [initial] : []);
  const existing = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: who[0]?.employee_id ?? "" }, enabled: !!who[0] });
  const [rows, setRows] = useState<Array<{ title: string; weight: string }> | null>(null);
  const items = rows ?? (existing.data?.items.map((i) => ({ title: i.title, weight: String(i.weight_pct) })) ?? [{ title: "", weight: "" }]);
  const total = items.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/performance/kpis/assign");
  const set = (i: number, k: "title" | "weight", v: string) => setRows(items.map((r, j) => (j === i ? { ...r, [k]: k === "weight" ? v.replace(/[^\d]/g, "").slice(0, 3) : v } : r)));
  const submit = async () => {
    setTried(true);
    if (!who.length || total !== 100 || items.some((r) => !r.title.trim())) return;
    try {
      await save.run({ body: { employee_id: who[0].employee_id, month: new Date().toISOString().slice(0, 7), items: items.map((r) => ({ title: r.title.trim(), weight_pct: Number(r.weight) })) } });
      invalidate("/api/v1/performance/kpis");
      close();
      toast(`KPIs saved for ${who[0].display_name}`);
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields?.items?.[0] ?? e.message) : "Could not save");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}>
        <EmployeePicker value={who} onChange={(v) => (setWho(v), setRows(null))} />
      </Field>
      {who.length > 0 && (
        <Field label="KPIs and Weights" state={tried && total !== 100 ? "bad" : undefined} message={tried && total !== 100 ? "Must total 100%" : undefined}>
          <div className="flex flex-col gap-1.5">
            {items.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextField value={r.title} onChange={(v) => set(i, "title", v)} placeholder={`KPI ${i + 1}`} aria-label={`KPI ${i + 1}`} />
                <span className="relative w-20 flex-none">
                  <TextField value={r.weight} onChange={(v) => set(i, "weight", v)} inputMode="numeric" aria-label={`Weight of KPI ${i + 1}`} className="pr-7 text-right" />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-subtle-foreground">%</span>
                </span>
                <button type="button" aria-label={`Remove KPI ${i + 1}`} className="flex size-8 flex-none items-center justify-center rounded-full text-subtle-foreground hover:bg-muted" onClick={() => setRows(items.filter((_, j) => j !== i))}><Icon name="x" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button size="sm" icon="plus" onClick={() => setRows([...items, { title: "", weight: "" }])}>Add KPI</Button>
              <b className={cn("text-xs", total === 100 ? "text-success" : "text-destructive")}>Total {total}%</b>
            </div>
          </div>
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Save KPIs</Button>
      </FormFooter>
    </>
  );
}
