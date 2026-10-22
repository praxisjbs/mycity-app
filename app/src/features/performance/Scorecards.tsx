/**
 * Performance · Scorecards (the `targets` tab): the interim screen, on the in-browser mock until its pull request lands.
 * PR 2 replaces this with the Scorecards view and a scorecard against the contract; PR 4 adds the Commitments view (Commitments.tsx).
 */
import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { Target } from "@/api/types/performance";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ChainCard, PagedTable, TrailCard, useDepartmentOptions } from "@/features/shared/sections";
import { Button, Field, formatDateTime, formatMonth, FormFooter, Grid, PageHeader, SelectField, StatusPill, TextField, toast, useContractForm, useModal } from "@mycity/ui";

const shiftMonth = (m: string, d: number) => {
  const [y, mm] = m.split("-").map(Number);
  const x = new Date(Date.UTC(y, mm - 1 + d, 1));
  return x.toISOString().slice(0, 7);
};

export function Scorecards() {
  const modal = useModal();
  const [month, setMonth] = useState<string | null>(null);
  const s = useApi("GET /api/v1/performance/targets/summary", { query: month ? { month } : {} });
  const m = month ?? s.data?.month ?? "";
  const list = usePaged("GET /api/v1/performance/targets", { filters: m ? { month: m } : {}, enabled: !!m });
  const approve = useMutation("POST /api/v1/performance/targets/:id/approve");
  const current = s.data?.month;
  return (
    <>
      <PageHeader
        title="Scorecards"
        sub={`Monthly and departmental · ${formatMonth(m)}`}
        actions={
          <>
            <Button icon="left" onClick={() => setMonth(shiftMonth(m, -1))} disabled={!m}>Previous Month</Button>
            {month && month !== current && <Button onClick={() => setMonth(null)}>This Month</Button>}
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Set Targets", body: (close) => <TargetForm close={close} month={m} /> })}>Set Targets</Button>
          </>
        }
      />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "Departments", value: String(s.data.departments) }, { label: "Approved", value: String(s.data.approved), tone: "ok" }, { label: "Awaiting CEO", value: String(s.data.awaiting), tone: s.data.awaiting ? "warn" : "ok" }, { label: "Binding From", value: "On approval" }]} />
          <ChainCard steps={s.data.chain} note="Nothing becomes binding until the CEO approves. Only then does it dispatch to staff." />
        </>
      )}
      <PagedTable<Target>
        title={`Departmental Targets, ${formatMonth(m).split(" ")[0]}`}
        list={list}
        rowKey={(t) => t.target_id}
        noun="target"
        wide
        empty={{ title: "No Targets Yet", text: "Department managers set them, then the CEO approves." }}
        columns={[
          { key: "dept", label: "Department", render: (t) => <span className="font-semibold">{t.department}</span> },
          { key: "target", label: "Target", render: (t) => t.title },
          { key: "up", label: "Rolls Up To", render: (t) => t.rolls_up_to, desktop: true },
          { key: "by", label: "Set By", render: (t) => t.set_by.display_name, desktop: true },
          { key: "measure", label: "Measure", render: (t) => t.measure, desktop: true },
          { key: "status", label: "Status", render: (t) => <StatusPill s={t.status} /> },
          {
            key: "act", label: "", render: (t) =>
              t.can_approve && (
                <Button size="sm" variant="primary" busy={approve.pending} onClick={async () => { await approve.run({ params: { id: t.target_id }, body: {} }); invalidate("/api/v1/performance/targets"); toast(`${t.department} target approved and dispatched`); }}>Approve</Button>
              ),
          },
        ]}
      />
      {s.data && (
        <Grid cols={2} className="mt-3">
          <BarsCard title={`${formatMonth(shiftMonth(s.data.month, -1)).split(" ")[0]} Results`} rows={s.data.last_month} />
          <TrailCard title={`${formatMonth(s.data.month).split(" ")[0]} Approval Trail`} items={s.data.trail.map((x) => ({ ...x, when: formatDateTime(x.when) }))} />
        </Grid>
      )}
    </>
  );
}

function TargetForm({ close, month }: { close: () => void; month: string }) {
  const depts = useDepartmentOptions("Pick the department");
  const goals = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual" } });
  const f = useContractForm({ department: "", title: "", measure: "", rolls_up_to: "" }, {
    department: (v) => (!v ? "Pick the department" : null),
    title: (v) => (v.trim().length < 4 ? "Name the target" : null),
    measure: (v) => (!v.trim() ? "How is it measured" : null),
    rolls_up_to: (v) => (!v ? "Pick the parent goal" : null),
  });
  const save = useMutation("POST /api/v1/performance/targets");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { month, ...f.values } });
      invalidate("/api/v1/performance/targets");
      close();
      toast("Target sent to the CEO for approval");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">For {formatMonth(month)}. It binds once the CEO approves.</p>
      <Field label="Department" {...f.field("department")}><SelectField options={depts.slice(1)} placeholder="Pick the department" {...f.field("department")} /></Field>
      <Field label="Target" {...f.field("title")}><TextField {...f.field("title")} placeholder="8 new prospects" /></Field>
      <Field label="Measure" {...f.field("measure")}><TextField {...f.field("measure")} placeholder="Count, days, date" /></Field>
      <Field label="Rolls Up To" {...f.field("rolls_up_to")}><SelectField placeholder="Annual goal" options={goals.rows.map((g) => [g.goal_id, g.title])} {...f.field("rolls_up_to")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Submit for Approval</Button>
      </FormFooter>
    </>
  );
}
