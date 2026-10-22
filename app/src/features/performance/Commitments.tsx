/**
 * Performance · Scorecards · Commitments (docs/guides/performance.md §3.4, §6.11, §10): the
 * month's commitments by person and function, their figures, Waiting On You with Approve Month and
 * Request Changes, and Export Report (the month-end delivery report). Its month and filters live
 * in the address, so a row that opens its task on My Workspace and Back return the person to the
 * same filtered list (F29).
 */
import { useEffect, type ReactNode } from "react";
import type { Commitment, CommitmentSetRow } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi, useMutation, usePaged, type PagedResult } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { commitmentMonths, commitmentPill, ORIGINAL_HELP, ReasonForm, refreshCommitments } from "@/features/workspace/Commitment";
import { useRouter, useSearchParams } from "@/lib/router";
import {
  ActionGroup,
  Button,
  DataView,
  DesktopOnly,
  ExportButton,
  FilterSelect,
  formatDate,
  formatDateTime,
  formatMonth,
  HelpTerm,
  PageHeader,
  PhoneOnly,
  StatusPill,
  toast,
  todayIso,
  Toolbar,
  useModal,
} from "@mycity/ui";
import { person } from "./shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");

const STATE_OPTIONS: Array<[string, string]> = [
  ["", "All States"],
  ["awaiting_approval", "Awaiting Approval"],
  ["due", "Due"],
  ["on_time", "On Time"],
  ["late", "Late"],
  ["missed", "Missed"],
  ["rescoped", "Rescoped"],
];

/** The months the switcher offers: the last five, this one and the next. */
function monthOptions(today = todayIso()): Array<[string, string]> {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const out: Array<[string, string]> = [];
  for (let i = -5; i <= 1; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push([key, formatMonth(`${key}-01`)]);
  }
  return out.reverse();
}

/** The Commitments view; `switcher` is the Scorecards and Commitments switch above it. */
export function Commitments({ switcher }: { switcher: ReactNode }) {
  const { navigate } = useRouter();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? commitmentMonths()[0][0].slice(0, 7);
  const dept = params.get("department_id") ?? "";
  const state = params.get("state") ?? "";
  const q = params.get("q") ?? "";
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const deptOptions: Array<[string, string]> = [["", "All Departments"], ...(departments.data?.data ?? []).filter((d) => d.active).map((d) => [d.department_id, d.name] as [string, string])];
  const filters = { month, ...(dept ? { department_id: dept } : {}), ...(state ? { state: state as Commitment["state"] } : {}) };
  const list = usePaged("GET /api/v1/performance/commitments", { filters, sort: "due_at" });
  const summary = useApi("GET /api/v1/performance/commitments/summary", { query: { month, ...(dept ? { department_id: dept } : {}) } });
  const waiting = usePaged("GET /api/v1/performance/commitments/sets", { filters: { waiting_on_me: "true" }, sort: "submitted_at" });

  // The search is a filter too: kept in the address, so Back finds it.
  const { setQ, q: typed } = list;
  useEffect(() => {
    if (q && !typed) setQ(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on arrival
  }, []);
  useEffect(() => {
    if (typed !== q) setParams({ q: typed || null }, { replace: true });
  }, [typed, q, setParams]);

  const set = (key: string) => (v: string) => setParams({ [key]: v || null }, { replace: true });
  const s = summary.data;
  const count = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const exportReport = () =>
    saveExport(api.call("POST /api/v1/performance/commitments/report", { body: { month, ...(dept ? { department_id: dept } : {}) } }));

  return (
    <>
      <PageHeader title="Commitments" sub={formatMonth(`${month}-01`)} actions={switcher} />
      <Toolbar>
        <FilterSelect label="Month" value={month} onChange={set("month")} options={monthOptions()} />
        <FilterSelect label="Department" value={dept} onChange={set("department_id")} options={deptOptions} />
        <FilterSelect label="State" value={state} onChange={set("state")} options={STATE_OPTIONS} />
        <ExportButton onExport={exportReport} message="Report saved">Export Report</ExportButton>
      </Toolbar>
      <DesktopOnly>
        <KpiTiles
          items={[
            { label: "Commitments", value: count(s?.commitments) },
            { label: "On Time", value: count(s?.on_time), tone: "ok" },
            { label: "Late or Missed", value: count(s ? s.late + s.missed : undefined), tone: s && s.late + s.missed ? "err" : undefined },
            { label: "Awaiting Approval", value: count(s?.awaiting_approval), tone: s?.awaiting_approval ? "warn" : undefined },
          ]}
        />
      </DesktopOnly>
      {s && (
        <PhoneOnly>
          <p className="mb-3 text-xs text-muted-foreground">{`${s.commitments} commitments · ${s.on_time} on time · ${s.late + s.missed} late or missed · ${s.awaiting_approval} awaiting`}</p>
        </PhoneOnly>
      )}
      {(waiting.page?.total ?? 0) > 0 && <WaitingOnYou list={waiting} />}
      <PagedTable
        title="Commitments"
        list={list}
        search="Search People"
        rowKey={(c) => c.task_id}
        noun="commitment"
        onRowClick={(c) => c.link && navigate(c.link.path)}
        empty={{ title: "No Commitments Yet" }}
        columns={[
          { key: "title", label: "Commitment", render: (c) => <span data-copy="content">{c.title}</span> },
          { key: "employee", label: "Person", render: (c) => (c.employee ? person(c.employee) : "–") },
          { key: "original", label: <HelpTerm help={ORIGINAL_HELP}>Original Date</HelpTerm>, render: (c) => (c.original_due_at ? formatDate(c.original_due_at) : "–") },
          { key: "due", label: "Due Now", render: (c) => (c.due_at ? formatDate(c.due_at) : "–"), desktop: true },
          { key: "state", label: "State", render: (c) => <StatusPill s={commitmentPill(c.state, c.set_status)} /> },
        ]}
      />
    </>
  );
}

/** Each person's month sent to the reader: Approve Month or Request Changes. */
function WaitingOnYou({ list }: { list: PagedResult<CommitmentSetRow> }) {
  const modal = useModal();
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const done = () => {
    list.reload();
    refreshCommitments();
  };
  const approveMonth = async (s: CommitmentSetRow) => {
    if (!s.workflow_instance_id) return;
    try {
      await approve.run({ params: { id: s.workflow_instance_id }, body: {} });
      done();
      toast("Month approved");
    } catch (e) {
      say(e);
    }
  };
  const requestChanges = (s: CommitmentSetRow) =>
    s.workflow_instance_id &&
    modal.open({ title: "Request Changes", body: (close) => <ReasonForm instanceId={s.workflow_instance_id!} close={() => (close(), done())} done="Month sent back" /> });
  return (
    <DataView
      title="Waiting On You"
      list={list}
      rowKey={(s) => s.commitment_set_id}
      noun="month"
      columns={[
        { key: "employee", label: "Person", render: (s) => person(s.employee) },
        { key: "month", label: "Month", render: (s) => formatMonth(s.month) },
        { key: "count", label: "Commitments", align: "n", render: (s) => String(s.task_count) },
        { key: "sent", label: "Sent", render: (s) => (s.submitted_at ? formatDateTime(s.submitted_at) : "–"), desktop: true },
        {
          key: "act",
          label: "Decision",
          render: (s) => (
            <ActionGroup>
              <Button size="sm" onClick={() => requestChanges(s)}>Request Changes</Button>
              <Button size="sm" variant="primary" onClick={() => approveMonth(s)}>Approve Month</Button>
            </ActionGroup>
          ),
        },
      ]}
    />
  );
}
