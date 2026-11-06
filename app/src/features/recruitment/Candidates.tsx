/**
 * Recruitment · Candidates (docs/guides/recruitment.md §6.3, §6.4, §10): every application on a
 * board of the five M4 stages, each column its own server list of 25 with Load More. The vacancy
 * filter narrows the board to one role (and its own columns); on a phone the board shows one stage at
 * a time and Move To sits in the card's menu and the sheet (F19). Invite to Apply and Screen With AI
 * open from the header, the address (`?action=invite|screen`, `?invite=1`) and ⌘K.
 */
import { useEffect, useRef, useState } from "react";
import candidateSchemas from "@mycity/contract/schemas/candidates.js";
import type { ApplicationStage, CandidatesCandidate, CandidatesCandidateListQuery } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useSearchParams } from "@/lib/router";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DesktopOnly,
  EmptyState,
  ErrorState,
  Field,
  FilterSelect,
  FormError,
  FormFooter,
  Grid,
  HelpTerm,
  Kanban,
  LoadingRows,
  PageHeader,
  Pill,
  SelectField,
  TextField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { CandidateSheet } from "./CandidateSheet";
import { say, sayRefusal, ScoreText, STAGE_LABEL, useVacancyOptions } from "./shared";

const BOARD: Array<[ApplicationStage, 1 | 2 | 3 | 4 | 5]> = [
  ["application", 4],
  ["screening", 3],
  ["assessment", 2],
  ["interview", 5],
  ["shortlist", 1],
];
const STATUS: Array<[string, string]> = [
  ["active", "In Progress"],
  ["not_progressed", "Not Progressing"],
];

type Filters = Pick<CandidatesCandidateListQuery, "vacancy_id" | "status">;

/** One stage: its own server list, more pages appended under it, highest weighted total first. */
function useColumn(stage: ApplicationStage, filters: Filters) {
  return useInfinite("GET /api/v1/recruitment/candidates", { filters: { ...filters, stage }, sort: "-weighted_total" });
}

const daysAt = (n: number) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);

export function Candidates() {
  const modal = useModal();
  const { can } = useAuth();
  const mayCreate = can("recruitment", "create");
  const mayEdit = can("recruitment", "edit");
  const [params, setParams] = useSearchParams();
  const [vacancy, setVacancy] = useState(params.get("vacancy") ?? "");
  const [status, setStatus] = useState("active");
  const vacancies = useVacancyOptions();
  const filters: Filters = { ...(vacancy ? { vacancy_id: vacancy } : {}), status: status as Filters["status"] };
  const summary = useApi("GET /api/v1/recruitment/candidates/summary", { query: vacancy ? { vacancy_id: vacancy } : {} });
  const role = useApi("GET /api/v1/recruitment/vacancies/:id", { params: { id: vacancy }, enabled: Boolean(vacancy) });
  const ai = useApi("GET /api/v1/recruitment/vacancies/assist", { enabled: mayEdit });
  const move = useMutation("POST /api/v1/recruitment/candidates/:id/move");
  const cols = {
    application: useColumn("application", filters),
    screening: useColumn("screening", filters),
    assessment: useColumn("assessment", filters),
    interview: useColumn("interview", filters),
    shortlist: useColumn("shortlist", filters),
  };
  const lists = Object.values(cols);
  const all = lists.flatMap((c) => c.rows);
  // A role's board has only the columns its scorecard uses (a role with no assessment has none).
  const board = role.data && vacancy ? BOARD.filter(([s]) => role.data!.board_stages.includes(s)) : BOARD;

  const open = (id: string, title = "Candidate") => modal.open({ title, wide: true, body: (close) => <CandidateSheet id={id} close={close} /> });
  const invite = () => modal.open({ title: "Invite to Apply", body: (close) => <InviteForm close={close} vacancyId={vacancy} /> });
  const screen = () => modal.open({ title: "Screen With AI", body: (close) => <ScreenForm close={close} vacancyId={vacancy} /> });
  useScreenAction(mayCreate ? { label: "Invite to Apply", onSelect: invite } : null);
  useScreenAction(mayEdit ? { label: "Screen With AI", onSelect: screen } : null, { second: true });
  useUrlAction("invite", mayCreate ? invite : null);
  useUrlAction("screen", mayEdit ? screen : null);

  // A candidate found with ⌘K (`?id=`), or Invite to Apply asked for (`?invite=1`), opens once and leaves the address.
  const linked = params.get("id");
  const asked = params.get("invite");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const ask = linked ? `id:${linked}` : asked === "1" && mayCreate ? "invite" : null;
    // Cleared once handled, so the same record asked for again opens again.
    if (!ask) return void (opened.current = null);
    if (opened.current === ask) return;
    opened.current = ask;
    setParams({ id: null, invite: null, vacancy: null }, { replace: true });
    if (linked) open(linked);
    else invite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, asked, mayCreate]);

  const onMove = async (card: string, to: string) => {
    const c = all.find((x) => x.application_id === card);
    if (!c) return;
    try {
      await move.run({ params: { id: card }, body: { stage: to as "application" } });
      invalidate("/api/v1/recruitment/candidates");
      toast(`${c.name} moved to ${STAGE_LABEL[to as ApplicationStage]}`);
    } catch (e) {
      say(e);
    }
  };

  const s = summary.data;
  const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const failed = lists.find((c) => c.error)?.error ?? null;
  const total = s?.distribution.reduce((n, b) => n + b.count, 0) ?? 0;
  return (
    <>
      <PageHeader
        title="Candidates"
        sub={role.data && vacancy ? role.data.title : undefined}
        actions={
          <>
            {mayEdit && ai.data?.available && <Button icon="spark" onClick={screen}>Screen With AI</Button>}
            {mayCreate && <Button variant="primary" icon="send" onClick={invite}>Invite to Apply</Button>}
          </>
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Candidates", value: counted(s?.candidates) },
          { label: "To Screen", value: counted(s?.to_screen), tone: s?.to_screen ? "warn" : undefined },
          { label: "In Interview", value: counted(s?.in_interview) },
          { label: "Shortlisted", value: counted(s?.shortlisted), tone: s?.shortlisted ? "ok" : undefined },
        ]}
      />
      <Toolbar>
        <FilterSelect label="Vacancy" value={vacancy} onChange={setVacancy} options={[["", "All Vacancies"], ...vacancies.options]} more={vacancies.more} onMore={vacancies.onMore} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS} />
      </Toolbar>
      {failed ? (
        <ErrorState error={failed} onRetry={() => Promise.all(lists.map((c) => c.reload()))} />
      ) : (
        <Kanban
          loading={lists.some((c) => !c.page && !c.error)}
          onMove={mayEdit && status === "active" ? (card, _from, to) => onMove(card, to) : undefined}
          onOpen={(card) => {
            const c = all.find((x) => x.application_id === card);
            if (c) open(c.application_id, c.name);
          }}
          empty={<EmptyState title={status === "active" ? "No Candidates Yet" : "No One Here"} />}
          columns={board.map(([stage, series]) => ({
            key: stage,
            label: STAGE_LABEL[stage],
            series,
            count: cols[stage as keyof typeof cols].page?.total,
            onMore: cols[stage as keyof typeof cols].page?.has_next ? cols[stage as keyof typeof cols].more : undefined,
            cards: cols[stage as keyof typeof cols].rows.map((c: CandidatesCandidate) => ({
              key: c.application_id,
              // Only the moves the server allows: ahead, or one back, on the role's own board.
              moves: c.next_stages,
              title: c.name,
              meta: (
                <>
                  {!vacancy && <Pill dot={false}>{c.vacancy.title}</Pill>}
                  <ScoreText score={c.score} provisional={c.score_provisional} />
                  <span className="text-xs text-subtle-foreground">{daysAt(c.days_at_stage)}</span>
                </>
              ),
            })),
          }))}
        />
      )}
      <DesktopOnly unmount>
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title={<HelpTerm help="Each candidate's screening score: the AI read of the CV when there is one, otherwise the estimate from the form.">Screening Scores</HelpTerm>} />
            {s ? <Bars rows={s.distribution.map((b) => ({ label: b.label, percent: total ? Math.round((b.count * 100) / total) : 0, value: String(b.count) }))} /> : <LoadingRows />}
          </Card>
        </Grid>
      </DesktopOnly>
    </>
  );
}

/** Invite to Apply: a person's name and email and the role; they get a link that works once, for seven days. */
function InviteForm({ close, vacancyId }: { close: () => void; vacancyId: string }) {
  const open = useVacancyOptions("open");
  const f = useContractForm({ first_name: "", last_name: "", email: "", vacancy_id: vacancyId }, candidateSchemas.ApplyInvite);
  const send = useMutation("POST /api/v1/recruitment/candidates/invitations");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const sent = await send.run({ body: f.values });
      close();
      toast(`Invitation sent to ${sent.email}`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Grid cols={2}>
        <Field label="First Name" {...f.status("first_name")}>
          <TextField {...f.field("first_name")} maxLength={80} />
        </Field>
        <Field label="Last Name" {...f.status("last_name")}>
          <TextField {...f.field("last_name")} maxLength={80} />
        </Field>
      </Grid>
      <Field label="Email" {...f.status("email")}>
        <TextField {...f.field("email")} placeholder="name@example.com" />
      </Field>
      <Field label="Vacancy" {...f.status("vacancy_id")}>
        <SelectField options={open.options} placeholder="Pick a role" more={open.more} onMore={open.onMore} {...f.field("vacancy_id")} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Invitation</Button>
      </FormFooter>
    </>
  );
}

/**
 * Screen With AI: the role, and one to three conditions a CV must meet ("Lives in Lagos"); every
 * application of the role not yet read is read. Kept on the role for the next time.
 */
function ScreenForm({ close, vacancyId }: { close: () => void; vacancyId: string }) {
  const roles = useVacancyOptions();
  const [vacancy, setVacancy] = useState(vacancyId);
  const role = useApi("GET /api/v1/recruitment/vacancies/:id", { params: { id: vacancy }, enabled: Boolean(vacancy) });
  const [conditions, setConditions] = useState<string[] | null>(null);
  const shown = conditions ?? (role.data?.screening_conditions.length ? role.data.screening_conditions : [""]);
  const [problem, setProblem] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<number, string>>({});
  const run = useMutation("POST /api/v1/recruitment/candidates/score-all");
  const submit = async () => {
    setProblem(null);
    setMarks({});
    if (!vacancy) return setProblem("Pick the role");
    // The rows sent, each with the row it came from, so a refusal lands on that row.
    const rows = shown.map((c, i) => [c.trim(), i] as const).filter(([c]) => c);
    const kept = rows.map(([c]) => c);
    try {
      const done = await run.run({ body: { vacancy_id: vacancy, ...(kept.length ? { screening_conditions: kept } : {}) } });
      invalidate("/api/v1/recruitment/candidates");
      close();
      toast(done.queued ? `${done.queued} applications being read` : "None waiting to be read");
    } catch (e) {
      // A refused condition is marked on its own field (screening_conditions.<n>).
      const fields = e instanceof ApiError ? Object.entries(e.fields).filter(([k]) => k.startsWith("screening_conditions.")) : [];
      if (fields.length) setMarks(Object.fromEntries(fields.map(([k, m]) => [rows[Number(k.split(".")[1])]?.[1] ?? 0, m[0] ?? ""])));
      else say(e);
    }
  };
  return (
    <>
      <Field label="Vacancy">
        <SelectField options={roles.options} placeholder="Pick a role" value={vacancy} onChange={(v) => (setVacancy(v), setConditions(null))} more={roles.more} onMore={roles.onMore} />
      </Field>
      {vacancy && !role.data ? (
        <LoadingRows count={2} />
      ) : (
        shown.map((c, i) => (
          <Field key={i} label={`Must Meet ${i + 1}`} optional={i > 0} {...(marks[i] ? { state: "bad" as const, message: marks[i] } : {})}>
            <TextField value={c} onChange={(v) => setConditions(shown.map((x, k) => (k === i ? v : x)))} placeholder="Lives in Lagos" maxLength={200} />
          </Field>
        ))
      )}
      {shown.length < 3 && <Button size="sm" icon="plus" onClick={() => setConditions([...shown, ""])}>Add Condition</Button>}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Screen Applications</Button>
      </FormFooter>
    </>
  );
}
