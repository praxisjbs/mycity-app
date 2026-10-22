/**
 * The week on My Workspace · Today (docs/guides/performance.md §6.18, §10; workspace.md §10): My
 * Week read off the board (done this week, planned next week, blocked) with the one line a person
 * writes, Support Needed, and Tidy With AI, which only suggests; Team This Week for a manager. The
 * weekly tracker retires.
 */
import { useState } from "react";
import workspace from "@mycity/contract/schemas/workspace.js";
import type { Task, TeamWeek, WeekView } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import {
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  EmptyValue,
  Field,
  formatDate,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  PhoneOnly,
  TapList,
  TextAreaField,
  toast,
  useContractForm,
  useModal,
} from "@mycity/ui";

const SUPPORT_HELP = "One line on what would help you this week. Your manager sees it.";
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");
const LISTS: Array<["done" | "planned" | "blocked", string]> = [
  ["done", "Done This Week"],
  ["planned", "Planned Next Week"],
  ["blocked", "Blocked"],
];

/** One of the week's lists: its tasks' titles, a blocked one with its reason. */
function TaskLines({ rows }: { rows: Task[] }) {
  if (!rows.length) return <p className="text-2xs text-subtle-foreground">None.</p>;
  return (
    <ul className="space-y-1">
      {rows.map((t) => (
        <li key={t.task_id} className="text-xs" data-copy="content">
          {t.title}
          {t.blocked_reason && <span className="block text-2xs text-subtle-foreground">{t.blocked_reason}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The week's three lists and the person's line: on desktop side by side, on a phone counts that open a sheet. */
function WeekBody({ week }: { week: WeekView }) {
  const modal = useModal();
  return (
    <>
      <DesktopOnly>
        <Grid cols={3}>
          {LISTS.map(([key, label]) => (
            <div key={key}>
              <div className="mb-1.5 text-2xs font-semibold text-muted-foreground">{`${label} · ${week[key].total}`}</div>
              <TaskLines rows={week[key].data.slice(0, 5)} />
            </div>
          ))}
        </Grid>
      </DesktopOnly>
      <PhoneOnly>
        <TapList
          flat
          label="My Week"
          items={LISTS.map(([key, label]) => ({
            key,
            title: label,
            end: String(week[key].total),
            onSelect: () => modal.open({ title: label, body: () => <TaskLines rows={week[key].data} /> }),
          }))}
        />
      </PhoneOnly>
      <KeyValue
        items={[
          [<HelpTerm key="h" help={SUPPORT_HELP}>Support Needed</HelpTerm>, week.support_needed ? <span data-copy="content">{week.support_needed}</span> : <EmptyValue />],
          ...(week.summary_text ? ([["Summary", <span key="s" className="whitespace-pre-line" data-copy="content">{week.summary_text}</span>]] as Array<[string, JSX.Element]>) : []),
        ]}
      />
    </>
  );
}

/** My Week on Today. */
export function MyWeekCard() {
  const read = useApi("GET /api/v1/workspace/week", { query: {} });
  const modal = useModal();
  const week = read.data;
  const write = () => week && modal.open({ title: "Support Needed", body: (close) => <SupportNeededForm week={week} close={close} /> });
  return (
    <Card>
      <CardHeader title="My Week" actions={week ? <Button size="sm" onClick={write}>Write Support Needed</Button> : undefined} />
      {!week ? <LoadingRows count={3} /> : <WeekBody week={week} />}
    </Card>
  );
}

/**
 * Write Support Needed, with Tidy With AI: the summary it suggests shows in place of the line until
 * the person uses or discards it; nothing changes until they pick.
 */
function SupportNeededForm({ week, close }: { week: WeekView; close: () => void }) {
  const f = useContractForm({ week_starts_on: week.week_starts_on, support_needed: week.support_needed ?? "" }, workspace.WeekSave);
  const save = useMutation("PUT /api/v1/workspace/week");
  const tidy = useMutation("POST /api/v1/workspace/week/tidy");
  const [summary, setSummary] = useState<{ text: string; run: string | null } | null>(null);
  const done = (message: string) => {
    invalidate("/api/v1/workspace");
    close();
    toast(message);
  };
  const saveLine = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { week_starts_on: week.week_starts_on, support_needed: f.values.support_needed || null } });
      done("Support Needed saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const tidyIt = async () => {
    const text = String(f.values.support_needed ?? "").trim();
    if (!text) {
      f.setServerErrors({ support_needed: ["Write a line first"] });
      return;
    }
    try {
      const r = await tidy.run({ body: { kind: "week", text } });
      if (!r.available || !r.tidied) toast("Tidy is off");
      else setSummary({ text: r.tidied, run: r.ai_run_id });
    } catch (e) {
      say(e);
    }
  };
  const useSummary = async () => {
    if (!summary) return;
    try {
      await save.run({
        body: { week_starts_on: week.week_starts_on, support_needed: f.values.support_needed || null, summary_text: summary.text, ai_run_id: summary.run },
      });
      done("Summary saved");
    } catch (e) {
      say(e);
    }
  };
  if (summary)
    return (
      <>
        <Card className="mb-3">
          <CardHeader title="Summary" />
          <p className="whitespace-pre-line text-xs" data-copy="content">{summary.text}</p>
        </Card>
        <FormFooter>
          <Button onClick={() => setSummary(null)}>Discard Summary</Button>
          <Button variant="primary" onClick={useSummary}>Use Summary</Button>
        </FormFooter>
      </>
    );
  return (
    <>
      <Field label="Support Needed" help={SUPPORT_HELP} optional {...f.field("support_needed")}>
        <TextAreaField {...f.field("support_needed")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button onClick={tidyIt}>Tidy With AI</Button>
        <Button variant="primary" onClick={saveLine}>Save Line</Button>
      </FormFooter>
    </>
  );
}

/** Team This Week, for a manager: one row per person in their scope; a row opens that person's week. */
export function TeamWeekCard() {
  const list = usePaged("GET /api/v1/workspace/team-weeks", { sort: "employee" });
  const modal = useModal();
  const open = (r: TeamWeek) =>
    modal.open({ title: r.employee.display_name, wide: true, body: () => <PersonWeek employeeId={r.employee.employee_id} /> });
  return (
    <DataView
      title="Team This Week"
      list={list}
      rowKey={(r) => r.employee.employee_id}
      noun="person"
      nounPlural="people"
      onRowClick={open}
      empty={{ title: "Nobody in Your Team" }}
      columns={[
        { key: "employee", label: "Person", render: (r) => r.employee.display_name },
        { key: "done", label: "Done", align: "n", render: (r) => String(r.done) },
        { key: "planned", label: "Planned", align: "n", render: (r) => String(r.planned) },
        { key: "blocked", label: "Blocked", align: "n", render: (r) => String(r.blocked) },
        { key: "support", label: "Support Needed", render: (r) => (r.support_needed ? <span data-copy="content">{r.support_needed}</span> : <EmptyValue />) },
      ]}
    />
  );
}

/** Someone's week, as their manager reads it. */
function PersonWeek({ employeeId }: { employeeId: string }) {
  const read = useApi("GET /api/v1/workspace/week", { query: { employee_id: employeeId } });
  if (!read.data) return <LoadingRows count={4} />;
  return (
    <>
      <p className="mb-2 text-2xs text-subtle-foreground">{`Week of ${formatDate(read.data.week_starts_on)}`}</p>
      <WeekBody week={read.data} />
    </>
  );
}
