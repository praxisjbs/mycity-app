/**
 * Recruitment · Vacancies (docs/guides/recruitment.md §6.1, §10): the roles MyCity is hiring for and
 * their lifecycle (draft, open, paused, closed). A vacancy opens in the wide dialog on desktop and a
 * sheet on a phone (ListDetail `modal`, F31 as amended 11/11/2026), with its public link, Edit, the
 * lifecycle, Questions, Scorecard and See Candidates. View Empty Seats lists the seats the organogram
 * leaves empty. Careers Settings and Candidate Emails open from here (`?panel=settings`, `?panel=emails`).
 */
import { useEffect, useRef, useState } from "react";
import type { SeatSuggestion, Vacancy, VacancyDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useAuth } from "@/auth/AuthProvider";
import { hrefFor, useRouter, useSearchParams } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  CheckboxField,
  ErrorState,
  FilterSelect,
  formatDate,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  ListDetail,
  LoadingRows,
  PageHeader,
  Pill,
  RichText,
  ChoiceField,
  Field,
  toast,
  Toolbar,
  useModal,
} from "@mycity/ui";
import { CandidateEmails } from "./CandidateEmails";
import { CareersSettings } from "./CareersSettings";
import { QuestionsForm, ScorecardForm } from "./VacancyQuestions";
import { VacancyForm } from "./VacancyForm";
import { EMPLOYMENT, PATTERN_LABEL, pill, say, STAGE_LABEL, VACANCY_STATUS } from "./shared";

const STATUSES: Array<[string, string]> = [
  ["", "All Statuses"],
  ["open", "Open"],
  ["paused", "Paused"],
  ["draft", "Draft"],
  ["closed", "Closed"],
];
const PAUSED_HELP = "Takes no applications. The link keeps working.";
const APPLICANTS_HELP = "Everyone who applied to an open or paused role, whatever became of them.";
const SCORECARD_HELP = "Switch off a part this role skips. The parts left on add up to 100.";

const closesOn = (v: Pick<Vacancy, "closes_at" | "past_closing">) =>
  v.closes_at ? <span className={v.past_closing ? "text-destructive font-semibold" : undefined}>{formatDate(v.closes_at.slice(0, 10))}</span> : "–";
const statusOf = (v: Pick<Vacancy, "status">) => (v.status === "paused" ? <HelpTerm help={PAUSED_HELP}>{pill(VACANCY_STATUS.paused)}</HelpTerm> : pill(VACANCY_STATUS[v.status]));

export function Vacancies() {
  const modal = useModal();
  const [status, setStatus] = useState("");
  const summary = useApi("GET /api/v1/recruitment/vacancies/summary");
  const list = usePaged("GET /api/v1/recruitment/vacancies", { filters: status ? { status: status as Vacancy["status"] } : {} });
  const { can } = useAuth();
  const mayCreate = can("recruitment", "create");
  // A pressed vacancy opens in the wide dialog on desktop and a sheet on a phone; nothing opens unasked.
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);

  const newVacancy = (seat?: SeatSuggestion) =>
    modal.open({ title: "New Vacancy", wide: true, body: (close) => <VacancyForm close={close} seat={seat} onSaved={(v) => openVacancy(v.vacancy_id, v.title)} /> });
  const openVacancy = (id: string, title = "Vacancy") => {
    modal.close();
    setPicked({ id, title });
  };
  const emptySeats = () => modal.open({ title: "Suggested From Organogram", wide: true, body: () => <EmptySeats mayCreate={mayCreate} onCreate={newVacancy} /> });
  const settings = () => modal.open({ title: "Careers Settings", wide: true, body: (close) => <CareersSettings close={close} /> });
  const emails = () => modal.open({ title: "Candidate Emails", wide: true, body: (close) => <CandidateEmails close={close} /> });

  useScreenAction(mayCreate ? { label: "New Vacancy", onSelect: () => newVacancy() } : null);
  useNewLink(mayCreate ? () => newVacancy() : null);

  // A vacancy found with ⌘K (`?id=`), or a panel asked for (`?panel=`), opens once and leaves the address.
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  const panel = params.get("panel");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const ask = linked ? `id:${linked}` : panel ? `panel:${panel}` : null;
    // Cleared once handled, so the same record asked for again opens again.
    if (!ask) return void (opened.current = null);
    if (opened.current === ask) return;
    opened.current = ask;
    setParams({ id: null, panel: null }, { replace: true });
    if (linked) openVacancy(linked);
    else if (panel === "settings") settings();
    else if (panel === "emails") emails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, panel]);

  const s = summary.data;
  const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));
  return (
    <>
      <PageHeader
        title="Vacancies"
        sub={s ? `${s.open} open · ${s.applicants} applicants` : undefined}
        actions={
          <>
            <Button icon="globe" onClick={() => s && window.open(s.site_url, "_blank", "noopener")}>Careers Page</Button>
            <Button icon="mail" onClick={emails}>Candidate Emails</Button>
            <Button icon="cog" onClick={settings}>Careers Settings</Button>
            {mayCreate && <Button variant="primary" icon="plus" onClick={() => newVacancy()}>New Vacancy</Button>}
          </>
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Open Vacancies", value: counted(s?.open) },
          { label: "Applicants", value: counted(s?.applicants), help: APPLICANTS_HELP },
          { label: "In Interview", value: counted(s?.in_interview) },
          { label: "Past Closing Date", value: counted(s?.past_closing), tone: s?.past_closing ? "warn" : undefined },
        ]}
      />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
        <Button icon="users" onClick={emptySeats}>View Empty Seats</Button>
      </Toolbar>
      <ListDetail
        layout="modal"
        size="wide"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title={picked?.title ?? "Vacancy"}
        list={
          <PagedTable<Vacancy>
            title="Vacancies"
            list={list}
            search="Search roles"
            rowKey={(v) => v.vacancy_id}
            noun="vacancy"
            nounPlural="vacancies"
            onRowClick={(v) => openVacancy(v.vacancy_id, v.title)}
            empty={{ title: "No Vacancies Yet" }}
            columns={[
              { key: "role", label: "Role", render: (v) => <span className="font-semibold">{v.title}</span> },
              { key: "dept", label: "Department", render: (v) => v.department ?? "–", desktop: true },
              { key: "openings", label: "Openings", align: "n", render: (v) => v.positions, desktop: true },
              { key: "where", label: "Location", render: (v) => (v.work_pattern === "remote" ? "Remote" : (v.location ?? "–")), desktop: true },
              { key: "apps", label: "Applicants", align: "n", render: (v) => v.applicants },
              { key: "closes", label: "Closes", render: closesOn },
              { key: "status", label: "Status", badge: true, render: statusOf },
            ]}
          />
        }
        detail={picked ? <VacancySheet key={picked.id} id={picked.id} close={() => setPicked(null)} /> : null}
      />
    </>
  );
}

/** The seats the organogram leaves empty, 25 a page, each with Create Vacancy (guide §3 step 1). */
function EmptySeats({ mayCreate, onCreate }: { mayCreate: boolean; onCreate: (seat: SeatSuggestion) => void }) {
  const seats = usePaged("GET /api/v1/recruitment/vacancies/suggested");
  return (
    <PagedTable<SeatSuggestion>
      list={seats}
      rowKey={(x) => x.org_seat_id}
      noun="seat"
      nounPlural="seats"
      empty={{ title: "No Empty Seats" }}
      columns={[
        { key: "title", label: "Seat", render: (x) => <span className="font-semibold">{x.title}</span> },
        { key: "dept", label: "Department", render: (x) => x.department },
        ...(mayCreate ? [{ key: "go", label: "", align: "n" as const, render: (x: SeatSuggestion) => <Button size="sm" onClick={() => onCreate(x)}>Create Vacancy</Button> }] : []),
      ]}
    />
  );
}

export function VacancySheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const read = useApi("GET /api/v1/recruitment/vacancies/:id", { params: { id } });
  const publish = useMutation("POST /api/v1/recruitment/vacancies/:id/publish");
  const pause = useMutation("POST /api/v1/recruitment/vacancies/:id/pause");
  const resume = useMutation("POST /api/v1/recruitment/vacancies/:id/resume");
  const v = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!v) return <LoadingRows count={6} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/vacancies");
  };
  const step = (run: typeof publish.run, done: string) => async () => {
    try {
      await run({ params: { id }, body: {} });
      reload();
      toast(done);
    } catch (e) {
      say(e);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.public_url ?? "");
      toast("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };
  const traits = v.questions.filter((q) => q.active && q.purpose === "interview");
  const asks = v.questions.filter((q) => q.active && q.purpose === "application");
  const live = v.status !== "closed";
  // A form opened from here sits over the vacancy's dialog, which is still open when the form closes.
  const back = () => modal.close();
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {statusOf(v)}
        <Pill dot={false}>{v.number}</Pill>
        {v.past_closing && <Pill tone="warn">Closing Date Passed</Pill>}
      </div>
      <KeyValue
        items={[
          ["Department", v.department ?? "–"],
          ["Hiring Manager", v.hiring_manager?.display_name ?? "–"],
          ["Location", v.work_pattern === "remote" ? "Remote" : (v.location ?? "–")],
          ["Arrangement", [PATTERN_LABEL[v.work_pattern ?? ""] ?? "–", v.work_pattern_note].filter(Boolean).join(", ")],
          ["Employment", EMPLOYMENT.find(([k]) => k === v.employment_type)?.[1] ?? "–"],
          ["Positions", String(v.positions)],
          ["Working Days", v.working_days ?? "–"],
          ["Closes", closesOn(v)],
          ["In Progress", `${v.in_progress} of ${v.applicants} applicants`],
          [
            "Public Link",
            v.public_url ? (
              <span key="link" className="inline-flex flex-wrap items-center gap-2">
                <span className="wrap-any">{v.public_url}</span>
                <Button size="sm" icon="copy" onClick={copy}>Copy Link</Button>
              </span>
            ) : (
              "Once published"
            ),
          ],
        ]}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title={<HelpTerm help={SCORECARD_HELP}>Scorecard Weights</HelpTerm>} level={3} />
          <KeyValue items={v.scorecard.map((p) => [p.name, p.active ? `${p.weight}%` : "Off"])} />
        </Card>
        <Card>
          <CardHeader title="Candidates by Stage" level={3} />
          <KeyValue items={v.by_stage.map((x) => [STAGE_LABEL[x.stage], String(x.count)])} />
        </Card>
      </Grid>
      <Card className="mt-3">
        <CardHeader title="Interview Traits" level={3} />
        {traits.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {traits.map((t) => (
              <li key={t.vacancy_question_id}>{t.prompt}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-subtle-foreground">One overall rating</p>
        )}
        {asks.length > 0 && (
          <>
            <CardHeader title="Apply Questions" level={4} className="mt-3" />
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {asks.map((q) => (
                <li key={q.vacancy_question_id}>{q.prompt}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card className="mt-3" data-copy="content">
        <CardHeader title="Description" level={3} />
        <RichText blocks={v.description_blocks} top={4} />
        {v.requirements_blocks && (
          <>
            <CardHeader title="Required Experience" level={4} className="mt-3" />
            <RichText blocks={v.requirements_blocks} top={4} />
          </>
        )}
        {v.nice_to_have_blocks && (
          <>
            <CardHeader title="Nice to Have" level={4} className="mt-3" />
            <RichText blocks={v.nice_to_have_blocks} top={4} />
          </>
        )}
      </Card>
      <FormFooter>
        <Button onClick={() => (close(), navigate(hrefFor("recruitment", "candidates", { vacancy: v.vacancy_id })))}>See Candidates</Button>
        {v.can_edit && live && (
          <>
            <Button onClick={() => modal.open({ title: "Edit Vacancy", wide: true, body: () => <VacancyForm vacancy={v} close={back} onSaved={reload} /> })}>Edit</Button>
            <Button onClick={() => modal.open({ title: "Questions", wide: true, body: () => <QuestionsForm vacancy={v} close={back} onSaved={reload} /> })}>Questions</Button>
            <Button onClick={() => modal.open({ title: "Scorecard", body: () => <ScorecardForm vacancy={v} close={back} onSaved={reload} /> })}>Scorecard</Button>
            <Button onClick={() => modal.open({ title: "Close Vacancy", body: () => <CloseForm vacancy={v} close={back} onSaved={reload} /> })}>Close Vacancy</Button>
            {v.status === "draft" && <Button variant="primary" onClick={step(publish.run, `${v.number} published`)}>Publish</Button>}
            {v.status === "open" && <Button variant="primary" onClick={step(pause.run, `${v.number} paused`)}>Pause</Button>}
            {v.status === "paused" && <Button variant="primary" onClick={step(resume.run, `${v.number} open again`)}>Resume</Button>}
          </>
        )}
      </FormFooter>
    </>
  );
}

const REASONS: Array<[NonNullable<VacancyDetail["close_reason"]>, string]> = [
  ["filled", "Filled"],
  ["cancelled", "Cancelled"],
  ["on_hold", "On Hold"],
];

const NOT_PROGRESS_HELP = "Each is marked Not Progressing and sent the Not Progressing email. Left unticked, they stay on the board and can be marked later.";

function CloseForm({ vacancy, close, onSaved }: { vacancy: VacancyDetail; close: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState<string>("filled");
  // Anyone still in progress can be told at once: each is marked Not Progressing and gets the email.
  const [rest, setRest] = useState(false);
  const save = useMutation("POST /api/v1/recruitment/vacancies/:id/close");
  const submit = async () => {
    try {
      await save.run({
        params: { id: vacancy.vacancy_id },
        body: { close_reason: reason as NonNullable<VacancyDetail["close_reason"]>, ...(rest ? { not_progress: true } : {}) },
      });
      if (rest) invalidate("/api/v1/recruitment/candidates");
      close();
      onSaved();
      toast(`${vacancy.number} closed`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Reason">
        <ChoiceField options={REASONS} value={reason} onChange={setReason} />
      </Field>
      {vacancy.in_progress > 0 && (
        <Field label={`${vacancy.in_progress} Still in Progress`} help={NOT_PROGRESS_HELP}>
          <CheckboxField label="Not Progress All" value={rest} onChange={setRest} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Close Vacancy</Button>
      </FormFooter>
    </>
  );
}
