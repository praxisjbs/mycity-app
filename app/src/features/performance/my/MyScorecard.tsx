/**
 * ESS · My Performance · My Scorecard and Rolls Up To: the person's quarter scorecard, its three
 * sections with each line's months and score, Agree Scorecard and Disagree With Reason, and each
 * linked line's path to the organisational goal (docs/guides/performance.md §6.5, §6.6, §10).
 */
import targetsContract from "@mycity/contract/schemas/targets.js";
import type { ScorecardDetail, ScorecardLine } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, DataView, EmptyState, Field, FormFooter, HelpTerm, LoadingRows, StatusPill, TapList, TextField, toast, useContractForm, useModal } from "@mycity/ui";
import { monthShort, score, SECTION_NAMES, targetOf } from "../shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const AUTO = new Set(["key_result", "team_result", "function_kpi", "commitments", "update_on_time", "team_reviews", "tasks"]);

/** The scorecard, its sections and lines; Agree and Disagree while it waits on the person. */
export function MyScorecard({ id }: { id: string }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/performance/scorecards/:id", { params: { id } });
  const period = useApi("GET /api/v1/performance/periods/:id", { params: { id: read.data?.performance_period_id ?? "" }, enabled: Boolean(read.data) });
  const agree = useMutation("POST /api/v1/performance/scorecards/:id/agree");
  const c = read.data;
  if (!c) return <LoadingRows count={4} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/ess/performance");
  };
  const agreeCard = async () => {
    try {
      await agree.run({ params: { id }, body: {} });
      reload();
      toast("Scorecard agreed");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {(["results", "kpis", "accountability"] as const).map((section) => (
        <Section key={section} section={section} card={c} months={period.data?.months ?? []} />
      ))}
      {c.can_agree && (
        <FormFooter>
          <Button onClick={() => modal.open({ title: "Disagree With Reason", body: (done) => <DisagreeForm id={id} close={() => (done(), reload())} /> })}>Disagree With Reason</Button>
          <Button variant="primary" onClick={agreeCard}>Agree Scorecard</Button>
        </FormFooter>
      )}
    </>
  );
}

function Section({ section, card, months }: { section: ScorecardLine["section"]; card: ScorecardDetail; months: string[] }) {
  return (
    <DataView
      className="mt-3"
      title={`${SECTION_NAMES[section]} · ${card[`${section}_weight`]}%`}
      rows={card.lines.filter((l) => l.section === section)}
      rowKey={(l) => l.employee_target_id}
      empty={{ title: "No Lines" }}
      columns={[
        {
          key: "title",
          label: section === "kpis" ? "KPI" : "Goal",
          render: (l) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {l.title}
              {AUTO.has(l.source) && (
                <HelpTerm help="Worked out by the system. Your reviewer can change it with a reason.">
                  <StatusPill s={{ tone: "info", text: "Auto" }} />
                </HelpTerm>
              )}
            </span>
          ),
        },
        { key: "target", label: "Target", render: (l) => targetOf(l) },
        { key: "weight", label: "Weight", align: "n", render: (l) => `${l.weight}%`, desktop: true },
        ...months.map((m) => ({ key: m, label: monthShort(m), align: "n" as const, desktop: true, render: (l: ScorecardLine) => score(l.months.find((x) => x.month === m)?.score) })),
        { key: "score", label: "Score", align: "n", render: (l) => score(l.score) },
      ]}
    />
  );
}

function DisagreeForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ disagree_reason: "" }, targetsContract.DisagreeBody);
  const save = useMutation("POST /api/v1/performance/scorecards/:id/disagree");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      close();
      toast("Sent to your reviewer");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("disagree_reason")}><TextField {...f.field("disagree_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Reason</Button>
      </FormFooter>
    </>
  );
}

/** Each line fed by a key result, and the path from it to the organisational goal. */
export function RollsUpTo({ id }: { id: string }) {
  const read = useApi("GET /api/v1/performance/scorecards/:id", { params: { id } });
  const linked = (read.data?.lines ?? []).filter((l) => l.okr_key_result_id);
  if (!read.data) return <LoadingRows count={3} />;
  if (!linked.length) return <EmptyState title="No Linked Lines" />;
  return <TapList label="Rolls Up To" items={linked.map((l) => ({ key: l.employee_target_id, title: l.title, sub: <Trace id={l.okr_key_result_id!} /> }))} />;
}

function Trace({ id }: { id: string }) {
  const kr = useApi("GET /api/v1/performance/key-results/:id", { params: { id } });
  if (!kr.data) return null;
  return <>{kr.data.trace.steps.map((s) => s.code ?? s.title).join(" › ")}</>;
}
