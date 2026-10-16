import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/recruitment";
import type { Assessment, Candidate, InterviewRow, OfferRow, OnboardingRow, PoolRow, Stage, Vacancy } from "@/api/types/recruitment";
import type { PersonRef } from "@/api/types/common";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ChainCard, ExportAction, PagedTable, TrailCard, useDepartmentOptions } from "@/features/shared/sections";
import { Letter } from "@/features/shared/Letter";
import type { ModuleScreenProps } from "@/shell/screens";
import { Button, Card, CardHeader, ChoiceField, cn, DataView, DateField, ErrorState, Field, FilterSelect, formatDate, formatDateTime, FormFooter, Grid, Kanban, KeyValue, LoadingRows, Meter, Money, MoneyField, PageHeader, Pill, Quote, SelectField, StatusPill, TextAreaField, TextField, Timeline, toast, todayIso, Toolbar, useContractForm, useModal, Who, Wizard } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";
import { toTrail } from "@/features/shared/wire";

export default function Recruitment({ tab, id }: ModuleScreenProps) {
  if (tab === "candidates") return <Candidates id={id} />;
  if (tab === "assessments") return <Assessments />;
  if (tab === "interviews") return <Interviews id={id} />;
  if (tab === "offers") return <Offers />;
  if (tab === "onboarding") return <Onboarding />;
  if (tab === "talent-pool") return <Pool />;
  return <Vacancies />;
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Vacancies ───────────── */

function Vacancies() {
  const modal = useModal();
  const s = useApi("GET /api/v1/recruitment/vacancies/summary");
  const list = usePaged("GET /api/v1/recruitment/vacancies");
  const open = (v: Vacancy) => modal.open({ title: v.title, body: (close) => <VacancyDetail v={v} close={close} /> });
  return (
    <>
      <PageHeader
        title="Vacancies"
        sub={s.data ? `${s.data.open} open · ${s.data.applicants} applicants` : " "}
        actions={
          <>
            <Button icon="globe" onClick={() => window.open("https://go.mycityapp.io/jobs", "_blank", "noopener")}>Careers Page</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Vacancy", wide: true, body: (close) => <VacancyForm close={close} /> })}>New Vacancy</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Open Vacancies", value: String(s.data.open) }, { label: "Applicants", value: String(s.data.applicants) }, { label: "In Interview", value: String(s.data.in_interview) }, { label: "Offers Out", value: String(s.data.offers_out), tone: s.data.offers_out ? "warn" : undefined }]} />}
      <PagedTable<Vacancy>
        title="Vacancies"
        list={list}
        search="Search roles"
        rowKey={(v) => v.vacancy_id}
        noun="vacancy"
        nounPlural="vacancies"
        onRowClick={open}
        wide
        columns={[
          { key: "r", label: "Role", render: (v) => <span className="font-semibold">{v.title}</span> },
          { key: "d", label: "Department", render: (v) => v.department, desktop: true },
          { key: "o", label: "Openings", align: "n", render: (v) => v.openings, desktop: true },
          { key: "l", label: "Location", render: (v) => v.location },
          { key: "a", label: "Applicants", align: "n", render: (v) => v.applicants },
          { key: "p", label: "Published", render: (v) => formatDate(v.published_on), desktop: true },
          { key: "s", label: "Status", render: (v) => <StatusPill s={v.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Funnel, All Vacancies" rows={s.data.funnel} /> : <Card><LoadingRows /></Card>}
        <DataView
          title="Vacancy Stages"
          rows={list.rows}
          rowKey={(v) => v.vacancy_id}
          loading={list.loading}
          onRowClick={open}
          columns={[
            { key: "r", label: "Role", render: (v) => v.title },
            { key: "d", label: "Days Open", align: "n", render: (v) => v.days_open },
            { key: "t", label: "Time at Stage", render: (v) => v.stage_note },
            { key: "n", label: "Next Step", render: (v) => v.next_step, desktop: true },
          ]}
        />
      </Grid>
    </>
  );
}

function VacancyDetail({ v, close }: { v: Vacancy; close: () => void }) {
  const { navigate } = useRouter();
  const pause = useMutation("POST /api/v1/recruitment/vacancies/:id/pause");
  const resume = useMutation("POST /api/v1/recruitment/vacancies/:id/resume");
  const flip = async () => {
    try {
      if (v.paused) await resume.run({ params: { id: v.vacancy_id }, body: {} });
      else await pause.run({ params: { id: v.vacancy_id }, body: {} });
      invalidate("/api/v1/recruitment");
      close();
      toast(v.paused ? `${v.title} is open again, on the same link` : `${v.title} paused. The link stays`);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <KeyValue items={[["Department", v.department], ["Openings", v.openings], ["Location", v.location], ["Applicants", v.applicants], ["Published", formatDate(v.published_on)], ["Status", <StatusPill key="s" s={v.status} />], ["Public link", v.public_url], ["Next step", v.next_step]]} />
      <FormFooter>
        <Button onClick={flip} busy={pause.pending || resume.pending}>{v.paused ? "Resume" : "Pause"}</Button>
        <Button variant="primary" onClick={() => (close(), navigate(`/recruitment?tab=candidates&vacancy=${v.vacancy_id}`))}>See Candidates</Button>
      </FormFooter>
    </>
  );
}

function VacancyForm({ close }: { close: () => void }) {
  const depts = useDepartmentOptions("Pick the department");
  const f = useContractForm({ title: "", department: "", openings: "1", location: "Lagos", arrangement: "hybrid", closes_on: "", description: "" }, {
    title: (v) => (v.trim().length < 3 ? "Name the role" : null),
    department: (v) => (!v ? "Pick the department" : null),
    openings: (v) => (!(Number(v) >= 1) ? "At least one" : null),
    location: (v) => (!v.trim() ? "Pick a location" : null),
    closes_on: (v) => (!v ? "Pick the closing date" : null),
    description: (v) => (v.trim().length < 40 ? "At least 40 characters" : null),
  });
  const save = useMutation("POST /api/v1/recruitment/vacancies");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const v = await save.run({ body: { ...f.values, openings: Number(f.values.openings), arrangement: f.values.arrangement as "hybrid" } });
      invalidate("/api/v1/recruitment/vacancies");
      close();
      toast(`${v.title} published at ${v.public_url}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <Wizard
      finish="Publish Vacancy"
      busy={save.pending}
      onFinish={() => void submit()}
      onCancel={close}
      steps={[
        {
          title: "Role",
          check: () => f.check(["title", "department", "location"]),
          body: (
            <>
              <Field label="Role" {...f.field("title")}><TextField {...f.field("title")} placeholder="e.g. Content Producer" /></Field>
              <Field label="Department" {...f.field("department")}><SelectField options={depts.slice(1)} placeholder="Pick the department" {...f.field("department")} /></Field>
              <Field label="Location" {...f.field("location")}><TextField {...f.field("location")} /></Field>
              <Field label="Arrangement"><ChoiceField value={f.values.arrangement} onChange={(v) => f.set("arrangement", v)} options={[["on_site", "On Site"], ["hybrid", "Hybrid"], ["remote", "Remote"]]} /></Field>
            </>
          ),
        },
        {
          title: "Details",
          check: () => f.check(["openings", "closes_on", "description"]),
          body: (
            <>
              <Field label="Openings" {...f.field("openings")}><TextField {...f.field("openings")} inputMode="numeric" onChange={(v) => f.set("openings", v.replace(/\D/g, "").slice(0, 2))} /></Field>
              <Field label="Closes On" {...f.field("closes_on")}><DateField {...f.field("closes_on")} min={todayIso()} /></Field>
              <Field label="About the Role" {...f.field("description")}><TextAreaField {...f.field("description")} rows={5} placeholder="Duties and requirements" /></Field>
            </>
          ),
        },
      ]}
    />
  );
}

/* ───────────── Candidates ───────────── */

const STAGES: Array<[Stage, string, string]> = [["applied", "Applied", "var(--chart-2)"], ["shortlisted", "Shortlisted", "var(--chart-3)"], ["interview", "Interview", "var(--chart-1)"], ["offer", "Offer", "var(--primary)"]];
const STAGE_LABEL: Record<Stage, string> = { applied: "Applied", shortlisted: "Shortlisted", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Not Progressed" };

function Candidates({ id }: { id: string | null }) {
  const modal = useModal();
  const { location } = useRouter();
  const vacancy = location.params.get("vacancy") ?? "";
  const vacs = usePaged("GET /api/v1/recruitment/vacancies");
  const [vac, setVac] = useState(vacancy);
  const s = useApi("GET /api/v1/recruitment/candidates/summary");
  const filters = (stage: Stage) => ({ stage, ...(vac ? { vacancy_id: vac } : {}) });
  const cols = [usePaged("GET /api/v1/recruitment/candidates", { filters: filters("applied") }), usePaged("GET /api/v1/recruitment/candidates", { filters: filters("shortlisted") }), usePaged("GET /api/v1/recruitment/candidates", { filters: filters("interview") }), usePaged("GET /api/v1/recruitment/candidates", { filters: filters("offer") })];
  const move = useMutation("POST /api/v1/recruitment/candidates/:id/move");
  const [sel, setSel] = useState<string | null>(id);
  const focus = sel ?? cols[2].rows[0]?.candidate_id ?? null;
  const openCard = (c: Candidate) => {
    setSel(c.candidate_id);
    modal.open({ title: c.name, body: (close) => <CandidateDetail id={c.candidate_id} close={close} /> });
  };
  const onMove = async (card: string, _from: string, to: string) => {
    try {
      if (to === "rejected") return;
      const c = await move.run({ params: { id: card }, body: { stage: to as Stage } });
      invalidate("/api/v1/recruitment");
      toast(`${c.name} moved to ${STAGE_LABEL[c.stage]}`);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <PageHeader
        title="Candidates"
        sub="Drag through the pipeline"
        actions={
          <>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Candidate", body: (close) => <AddCandidate close={close} vacancies={vacs.rows} /> })}>Add Candidate</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Candidates", value: String(s.data.candidates) }, { label: "In the Kanban", value: String(s.data.in_board) }, { label: "Awaiting a Human", value: String(s.data.awaiting_human), tone: s.data.awaiting_human ? "warn" : "ok" }, { label: "Average Score", value: String(s.data.average_score) }]} />}
      <Toolbar>
        <FilterSelect label="Role" value={vac} onChange={setVac} options={[["", "All Roles"], ...vacs.rows.map((v) => [v.vacancy_id, v.title] as [string, string])]} />
      </Toolbar>
      <Kanban
        onMove={onMove}
        columns={STAGES.map(([k, label, color], i) => ({
          key: k,
          label,
          color,
          count: cols[i].page?.total,
          cards: cols[i].rows.map((c) => ({ key: c.candidate_id, title: c.name, meta: <><Pill dot={false}>{c.vacancy.title}</Pill><StatusPill s={c.chip} /></>, onClick: () => openCard(c) })),
        }))}
      />
      <Grid cols={2} className="mt-3">
        {focus ? <CandidateCard id={focus} /> : <Card><LoadingRows /></Card>}
        {s.data ? <BarsCard title="Score Distribution, All Applicants" rows={s.data.distribution} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function CandidateCard({ id }: { id: string }) {
  const c = useApi("GET /api/v1/recruitment/candidates/:id", { params: { id } });
  if (!c.data) return <Card>{c.error ? <ErrorState error={c.error} /> : <LoadingRows />}</Card>;
  const d = c.data;
  return (
    <Card>
      <CardHeader title={d.name} right={<StatusPill s={d.chip} />} />
      <KeyValue
        items={[
          ["Role", d.vacancy.title],
          ["Applied", `${formatDate(d.applied_on)}, ${d.source.toLowerCase()}`],
          ["Screening score", <span key="s" className="inline-flex items-center gap-1.5">{d.score ?? "Not scored"}{d.score_provisional && <Pill tone="info">Provisional</Pill>}</span>],
          ["Assessments", d.assessments ?? "Not taken"],
          ["Interview", d.interview ?? "Not scheduled"],
          ["Weighted total", d.weighted_total ? <b key="w">{d.weighted_total} of 100</b> : "After the panel closes"],
        ]}
      />
      <Quote className="mt-3">Provisional means the form was read and the CV was not. It becomes final when a person opens the document.</Quote>
    </Card>
  );
}

function CandidateDetail({ id, close }: { id: string; close: () => void }) {
  const c = useApi("GET /api/v1/recruitment/candidates/:id", { params: { id } });
  const move = useMutation("POST /api/v1/recruitment/candidates/:id/move");
  const pool = useMutation("POST /api/v1/recruitment/candidates/:id/pool");
  const [reject, setReject] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  if (!c.data) return c.error ? <ErrorState error={c.error} /> : <LoadingRows />;
  const d = c.data;
  const go = async (stage: Stage) => {
    try {
      await move.run({ params: { id }, body: { stage, ...(stage === "rejected" ? { reason: reject ?? "" } : {}) } });
      invalidate("/api/v1/recruitment");
      close();
      toast(`${d.name} moved to ${STAGE_LABEL[stage]}`);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <KeyValue items={[["Role", d.vacancy.title], ["Stage", STAGE_LABEL[d.stage]], ["Email", d.email], ["Score", d.score ?? "Not scored"], ["Assessments", d.assessments ?? "Not taken"], ["Interview", d.interview ?? "Not scheduled"]]} />
      {reject != null && (
        <div className="mt-3">
          <Field label="Why Not Progressed" info="It goes on the record and in the candidate's email." state={tried && !reject.trim() ? "bad" : undefined} message="Give a reason">
            <TextAreaField value={reject} onChange={setReject} placeholder="Strong, needs partnerships" />
          </Field>
        </div>
      )}
      <FormFooter>
        {reject == null ? (
          <>
            {d.stage !== "rejected" && d.stage !== "hired" && <Button className="mr-auto" onClick={() => setReject("")}>Not Progressing</Button>}
            {d.stage === "rejected" && (
              <Button className="mr-auto" busy={pool.pending} onClick={async () => { await pool.run({ params: { id }, body: { reason: "Strong, wrong moment" } }); invalidate("/api/v1/recruitment/pool"); close(); toast(`${d.name} added to the talent pool`); }}>Add to Talent Pool</Button>
            )}
            {d.next_stages.filter((x) => x !== "rejected").map((x) => (
              <Button key={x} variant="primary" busy={move.pending} onClick={() => go(x)}>Move to {STAGE_LABEL[x]}</Button>
            ))}
            {!d.next_stages.length && <Button onClick={close}>Close</Button>}
          </>
        ) : (
          <>
            <Button onClick={() => setReject(null)}>Back</Button>
            <Button variant="primary" busy={move.pending} onClick={() => (reject.trim() ? go("rejected") : setTried(true))}>Confirm</Button>
          </>
        )}
      </FormFooter>
    </>
  );
}

function AddCandidate({ close, vacancies }: { close: () => void; vacancies: Vacancy[] }) {
  const f = useContractForm({ name: "", email: "", vacancy_id: "" }, { name: (v) => (v.trim().length < 3 ? "Enter the full name" : null), email: (v) => (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "Enter a valid email" : null), vacancy_id: (v) => (!v ? "Pick the vacancy" : null) });
  const save = useMutation("POST /api/v1/recruitment/candidates");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const c = await save.run({ body: f.values });
      invalidate("/api/v1/recruitment");
      close();
      toast(`${c.name} added. They get a form link`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Full Name" {...f.field("name")}><TextField {...f.field("name")} /></Field>
      <Field label="Email" {...f.field("email")}><TextField {...f.field("email")} type="email" /></Field>
      <Field label="Vacancy" {...f.field("vacancy_id")}><SelectField placeholder="Pick the vacancy" options={vacancies.filter((v) => !v.paused).map((v) => [v.vacancy_id, v.title])} {...f.field("vacancy_id")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Candidate</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Assessments ───────────── */

function Assessments() {
  const modal = useModal();
  const s = useApi("GET /api/v1/recruitment/assessments/summary");
  const list = usePaged("GET /api/v1/recruitment/assessments");
  return (
    <>
      <PageHeader title="Assessments" sub="Psychometric, technical and case study" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Assessment", body: (close) => <AssessmentForm close={close} /> })}>New Assessment</Button>} />
      {s.data && <KpiTiles items={[{ label: "Assessments", value: String(s.data.assessments) }, { label: "Taken", value: String(s.data.taken) }, { label: "Average Score", value: String(s.data.average_score) }, { label: "Abandoned", value: String(s.data.abandoned), tone: s.data.abandoned ? "warn" : undefined }]} />}
      <PagedTable<Assessment>
        title="Assessments"
        list={list}
        search="Search assessments"
        rowKey={(a) => a.assessment_id}
        noun="assessment"
        wide
        columns={[
          { key: "n", label: "Assessment", render: (a) => <span className="font-semibold">{a.name}</span> },
          { key: "r", label: "Role", render: (a) => a.role },
          { key: "k", label: "Type", render: (a) => a.kind, desktop: true },
          { key: "d", label: "Duration", render: (a) => `${a.duration_min} min`, desktop: true },
          { key: "c", label: "Candidates", align: "n", render: (a) => a.candidates },
          { key: "a", label: "Avg Score", align: "n", render: (a) => a.average_score ?? "None yet" },
          { key: "s", label: "Status", render: (a) => <StatusPill s={a.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Average Score by Assessment" rows={s.data.by_assessment} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function AssessmentForm({ close }: { close: () => void }) {
  const f = useContractForm({ name: "", role: "All roles", kind: "Psychometric", duration_min: "30" }, { name: (v) => (v.trim().length < 3 ? "Name the assessment" : null), duration_min: (v) => (!(Number(v) >= 5) ? "At least 5 minutes" : null) });
  const save = useMutation("POST /api/v1/recruitment/assessments");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name.trim(), role: f.values.role, kind: f.values.kind as Assessment["kind"], duration_min: Number(f.values.duration_min) } });
      invalidate("/api/v1/recruitment/assessments");
      close();
      toast("Assessment draft saved. Add questions from the bank");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Name" {...f.field("name")}><TextField {...f.field("name")} placeholder="e.g. Verbal reasoning" /></Field>
      <Field label="Type"><SelectField options={[["Psychometric", "Psychometric"], ["Technical", "Technical"], ["Case study", "Case Study"]]} {...f.field("kind")} /></Field>
      <Field label="Duration (Minutes)" {...f.field("duration_min")}><TextField {...f.field("duration_min")} inputMode="numeric" onChange={(v) => f.set("duration_min", v.replace(/\D/g, "").slice(0, 3))} /></Field>
      <Field label="Taken By"><TextField {...f.field("role")} placeholder="Any role" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Save Assessment</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Interviews ───────────── */

function Interviews({ id }: { id: string | null }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/recruitment/interviews");
  const [sel, setSel] = useState<string | null>(id);
  const focus = sel ?? list.rows[0]?.interview_id ?? null;
  const d = useApi("GET /api/v1/recruitment/interviews/:id", { params: { id: focus ?? "" }, enabled: !!focus });
  const consolidate = useMutation("POST /api/v1/recruitment/interviews/:id/consolidate");
  const x = d.data;
  return (
    <>
      <PageHeader
        title="Interviews"
        sub={x ? `Blind panel · ${x.candidate}, ${x.role}` : "Blind panels"}
        actions={
          <>
            <Button icon="clock" onClick={() => modal.open({ title: "Schedule Interview", body: (close) => <ScheduleInterview close={close} /> })}>Schedule</Button>
            <Button
              variant="primary"
              disabled={!x || x.round.text === "Closed" || consolidate.pending}
              onClick={async () => {
                try {
                  await consolidate.run({ params: { id: x!.interview_id }, body: {} });
                  invalidate("/api/v1/recruitment/interviews");
                  toast("Round closed. The panel now sees scores");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Consolidate
            </Button>
          </>
        }
      />
      {x && (
        <Grid cols={2}>
          <DataView
            title="Panel"
            right={<StatusPill s={x.round} />}
            rows={x.panel}
            rowKey={(p) => p.panellist.employee_id}
            columns={[
              { key: "p", label: "Panellist", render: (p) => <Who name={p.panellist.display_name} sub={p.panellist.department ?? undefined} /> },
              { key: "s", label: "Submitted", render: (p) => <StatusPill s={p.submitted ? { tone: "ok", text: "Submitted" } : { tone: "warn", text: "Pending" }} /> },
              { key: "n", label: "Score", align: "n", render: (p) => (p.sealed ? <span className="text-subtle-foreground">Hidden</span> : (p.score ?? <span className="text-subtle-foreground">None</span>)) },
            ]}
          />
          <BarsCard title="Weighted Scorecard" rows={x.scorecard} />
        </Grid>
      )}
      <div className="mt-3">
        <PagedTable<InterviewRow>
          title="Upcoming and Recent"
          list={list}
          rowKey={(r) => r.interview_id}
          noun="interview"
          onRowClick={(r) => setSel(r.interview_id)}
          columns={[
            { key: "c", label: "Candidate", render: (r) => <span className={cn(r.interview_id === focus && "font-semibold")}>{r.candidate}</span> },
            { key: "r", label: "Role", render: (r) => r.role, desktop: true },
            { key: "d", label: "Date", render: (r) => formatDateTime(r.at) },
            { key: "p", label: "Panel", render: (r) => `${r.panel_size} panellists`, desktop: true },
            { key: "s", label: "Round", render: (r) => <StatusPill s={r.round} /> },
          ]}
        />
      </div>
      <Grid cols={2} className="mt-3">
        {x ? <TrailCard title="Round Activity" items={x.activity.map((a) => ({ ...a, when: formatDateTime(a.when) }))} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function ScheduleInterview({ close }: { close: () => void }) {
  const cands = usePaged("GET /api/v1/recruitment/candidates", { filters: { stage: "shortlisted" } });
  const [panel, setPanel] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useContractForm({ candidate_id: "", date: "", time: "10:00" }, { candidate_id: (v) => (!v ? "Pick the candidate" : null), date: (v) => (!v ? "Pick the day" : null), time: (v) => (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? "HH:MM, 24 hour" : null) });
  const save = useMutation("POST /api/v1/recruitment/interviews");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !panel.length) return;
    try {
      await save.run({ body: { candidate_id: f.values.candidate_id, at: `${f.values.date}T${f.values.time}:00+01:00`, panel_ids: panel.map((p) => p.employee_id) } });
      invalidate("/api/v1/recruitment");
      close();
      toast("Interview scheduled. Panellists get invites and scorecards");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Candidate" {...f.field("candidate_id")}><SelectField placeholder="Shortlisted candidate" options={cands.rows.map((c) => [c.candidate_id, `${c.name} · ${c.vacancy.title}`])} {...f.field("candidate_id")} /></Field>
      <Field label="Date" {...f.field("date")}><DateField {...f.field("date")} min={todayIso()} /></Field>
      <Field label="Time (24 Hour)" {...f.field("time")}><TextField {...f.field("time")} inputMode="numeric" placeholder="10:00" /></Field>
      <Field label="Panel" state={tried && !panel.length ? "bad" : undefined} message={tried && !panel.length ? "Add at least one panellist" : undefined}><EmployeePicker multiple value={panel} onChange={setPanel} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Schedule</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Offers ───────────── */

function Offers() {
  const modal = useModal();
  const s = useApi("GET /api/v1/recruitment/offers/summary");
  const list = usePaged("GET /api/v1/recruitment/offers");
  const [sel, setSel] = useState<OfferRow | null>(null);
  const shown = sel ?? list.rows[0] ?? null;
  const letter = useApi("GET /api/v1/recruitment/offers/:id/letter", { params: { id: shown?.offer_id ?? "" }, enabled: !!shown });
  const send = useMutation("POST /api/v1/recruitment/offers/:id/send");
  return (
    <>
      <PageHeader title="Offers" sub="Generated, sent, signed" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Offer", body: (close) => <OfferForm close={close} /> })}>New Offer</Button>} />
      {s.data && <KpiTiles items={[{ label: "Awaiting Signature", value: String(s.data.awaiting_signature), tone: s.data.awaiting_signature ? "warn" : undefined }, { label: "Signed, This Year", value: String(s.data.signed_this_year), tone: "ok" }, { label: "Declined", value: String(s.data.declined) }, { label: "Average Time to Sign", value: s.data.average_days_to_sign }]} />}
      <Grid cols="1/1.5">
        <PagedTable<OfferRow>
          title="Offers"
          list={list}
          rowKey={(o) => o.offer_id}
          noun="offer"
          onRowClick={setSel}
          columns={[
            { key: "c", label: "Candidate", render: (o) => <span className={cn(o.offer_id === shown?.offer_id && "font-semibold")}>{o.candidate}</span> },
            { key: "m", label: "Salary", align: "n", render: (o) => <Money value={o.salary} /> },
            { key: "s", label: "Status", render: (o) => <StatusPill s={o.status} /> },
          ]}
        />
        <div>
          {letter.data ? <Letter l={letter.data} note={`Offer letter ${letter.data.reference}, generated from the template and the vacancy.`} /> : <Card><LoadingRows count={6} /></Card>}
          {shown?.status.text === "Draft" && (
            <div className="mt-2 flex justify-end">
              <Button variant="primary" icon="send" busy={send.pending} onClick={async () => { try { await send.run({ params: { id: shown.offer_id }, body: {} }); invalidate("/api/v1/recruitment/offers"); toast(`${shown.number} sent to ${shown.candidate} to sign`); } catch (e) { fail(e); } }}>Send to Sign</Button>
            </div>
          )}
        </div>
      </Grid>
    </>
  );
}

function OfferForm({ close }: { close: () => void }) {
  const cands = usePaged("GET /api/v1/recruitment/candidates", { filters: { stage: "interview" } });
  const f = useContractForm({ candidate_id: "", salary: "", start_date: "", expires_on: "" }, { candidate_id: (v) => (!v ? "Pick the candidate" : null), salary: (v) => (!(Number(v) > 0) ? "Enter the salary" : null), start_date: (v) => (!v ? "Pick the start date" : null), expires_on: (v) => (!v ? "Pick when it expires" : null) });
  const save = useMutation("POST /api/v1/recruitment/offers");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const o = await save.run({ body: f.values });
      invalidate("/api/v1/recruitment/offers");
      close();
      toast(`${o.number} drafted. Review it, then send to sign`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Candidate" {...f.field("candidate_id")}><SelectField placeholder="Interviewed candidate" options={cands.rows.map((c) => [c.candidate_id, `${c.name} · ${c.vacancy.title}`])} {...f.field("candidate_id")} /></Field>
      <Field label="Gross Monthly Salary" {...f.field("salary")}><MoneyField {...f.field("salary")} /></Field>
      <Field label="Start Date" {...f.field("start_date")}><DateField {...f.field("start_date")} min={todayIso()} /></Field>
      <Field label="Offer Expires" {...f.field("expires_on")}><DateField {...f.field("expires_on")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Draft Offer</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Onboarding ───────────── */

function Onboarding() {
  const s = useApi("GET /api/v1/recruitment/onboarding/summary");
  const list = usePaged("GET /api/v1/recruitment/onboarding");
  const [sel, setSel] = useState<string | null>(null);
  const focus = sel ?? s.data?.focus_id ?? null;
  const d = useApi("GET /api/v1/recruitment/onboarding/:id", { params: { id: focus ?? "" }, enabled: !!focus });
  const remind = useMutation("POST /api/v1/recruitment/onboarding/:id/remind");
  const x = d.data;
  return (
    <>
      <PageHeader title="Onboarding" sub="Documentation first, then onboarding" />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "In Progress", value: String(s.data.in_progress) }, { label: "Blocked on Documents", value: String(s.data.blocked), tone: s.data.blocked ? "warn" : "ok" }, { label: "Starting This Month", value: String(s.data.starting_this_month) }, { label: "Confirmed, 90d", value: String(s.data.confirmed_90d), tone: "ok" }]} />
          <ChainCard steps={s.data.chain} note="Onboarding does not open until the document checklist completes. That sequence was requested by MyCity." />
        </>
      )}
      <PagedTable<OnboardingRow>
        title="In Progress"
        list={list}
        rowKey={(o) => o.onboarding_id}
        noun="new hire"
        onRowClick={(o) => setSel(o.onboarding_id)}
        columns={[
          { key: "n", label: "New Hire", render: (o) => <span className={cn(o.onboarding_id === focus && "font-semibold")}>{o.name}</span> },
          { key: "r", label: "Role", render: (o) => o.role, desktop: true },
          { key: "s", label: "Start Date", render: (o) => formatDate(o.start_date) },
          { key: "d", label: "Documents", render: (o) => `${o.documents_done} of ${o.documents_total}` },
          { key: "st", label: "Stage", render: (o) => <StatusPill s={o.stage} /> },
        ]}
      />
      {x && (
        <Grid cols={2} className="mt-3">
          <DataView
            title="Document Checklist"
            right={<span className="w-[150px]"><Meter pct={Math.round((x.documents_done * 100) / x.documents_total)} label={`${x.documents_done} of ${x.documents_total}`} /></span>}
            rows={x.checklist}
            rowKey={(r) => r.name}
            columns={[{ key: "d", label: "Required Document", render: (r) => r.name }, { key: "s", label: x.name, render: (r) => <StatusPill s={r.status} /> }]}
            footer={
              x.documents_done < x.documents_total && (
                <div className="flex justify-end border-t border-border px-[14px] py-2.5">
                  <Button size="sm" icon="bell" busy={remind.pending} onClick={async () => { await remind.run({ params: { id: x.onboarding_id }, body: {} }); toast(`Reminder sent to ${x.name} for ${x.documents_total - x.documents_done} documents`); }}>Remind {x.name.split(" ")[0]}</Button>
                </div>
              )
            }
          />
          <Card>
            <CardHeader title="Onboarding Plan" />
            <Timeline items={toTrail(x.plan.map((p) => ({ title: p.title, when: p.text, tone: p.done ? "ok" as const : null })))} />
          </Card>
        </Grid>
      )}
    </>
  );
}

/* ───────────── Talent pool ───────────── */

function Pool() {
  const modal = useModal();
  const s = useApi("GET /api/v1/recruitment/pool/summary");
  const list = usePaged("GET /api/v1/recruitment/pool");
  return (
    <>
      <PageHeader title="Talent Pool" sub="Good candidates, wrong moment" actions={<ExportAction source="recruitment.pool" />} />
      {s.data && <KpiTiles items={[{ label: "In the Pool", value: String(s.data.in_pool) }, { label: "Invited Back", value: String(s.data.invited_back) }, { label: "Hired From the Pool", value: String(s.data.hired_from_pool), tone: "ok" }, { label: "Average Score", value: String(s.data.average_score) }]} />}
      <Grid cols="1.4/1">
        <PagedTable<PoolRow>
          title="The Pool"
          list={list}
          search="Search the pool"
          rowKey={(p) => p.pool_id}
          noun="candidate"
          wide
          columns={[
            { key: "n", label: "Candidate", render: (p) => <span className="font-semibold">{p.name}</span> },
            { key: "a", label: "Applied For", render: (p) => p.applied_for },
            { key: "s", label: "Score", align: "n", render: (p) => p.score },
            { key: "d", label: "Added", render: (p) => formatDate(p.added_on), desktop: true },
            { key: "r", label: "Reason", render: (p) => p.reason, desktop: true },
            { key: "x", label: "", render: (p) => (p.invited ? <Pill tone="ok">Invited</Pill> : <Button size="sm" onClick={() => modal.open({ title: `Invite ${p.name}`, body: (close) => <Invite p={p} close={close} /> })}>Invite to Apply</Button>) },
          ]}
        />
      </Grid>
    </>
  );
}

function Invite({ p, close }: { p: PoolRow; close: () => void }) {
  const vacs = usePaged("GET /api/v1/recruitment/vacancies", { filters: { status: "open" } });
  const [vac, setVac] = useState("");
  const [tried, setTried] = useState(false);
  const invite = useMutation("POST /api/v1/recruitment/pool/:id/invite");
  return (
    <>
      <Field label="Vacancy" state={tried && !vac ? "bad" : undefined} message="Pick a vacancy"><SelectField value={vac} onChange={setVac} placeholder="Open vacancy" options={vacs.rows.map((v) => [v.vacancy_id, v.title])} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={invite.pending} onClick={async () => { if (!vac) return setTried(true); try { await invite.run({ params: { id: p.pool_id }, body: { vacancy_id: vac } }); invalidate("/api/v1/recruitment/pool"); close(); toast(`Invitation sent to ${p.name}`); } catch (e) { fail(e); } }}>Send Invitation</Button>
      </FormFooter>
    </>
  );
}

