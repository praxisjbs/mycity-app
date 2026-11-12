/**
 * Recruitment · Offers (docs/guides/offers.md §2, §3, §10; M5, owner AJ): every offer in the
 * reader's scope with the figures above it, across the page; a row opens its offer in a wide dialog
 * on desktop, its cards side by side over the letter, and in a sheet on a phone (ListDetail `modal`,
 * F31 as amended 08/11/2026). The offer shows its summary and status, the monthly pay lines and total with
 * the vacancy's range, its approval, signers and history, the letter as the candidate reads it and
 * the PDF. What a person may do comes from the record's `can_*`: Edit and Submit for Approval on a
 * draft, Approve and Reject for the approver the flow waits on, Sign for the Company for the Offer
 * Signatory, Send Offer once signed, Resend while with the candidate, Withdraw while open.
 *
 * The address opens what the assistant, ⌘K and the board ask for: `?id=` an offer, `?new=1` New
 * Offer (with `&application=` its candidate), `?application=` the offer of a board card, `?status=`
 * a filter, `?panel=settings` the Offers settings.
 */
import { useEffect, useRef, useState } from "react";
import offerSchemas from "@mycity/contract/schemas/offers.js";
import type { OfferDetail, OfferRow, OfferStatus } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveBlob, useFileBlob } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  ActionGroup,
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  DocumentPreview,
  EmptyState,
  cn,
  ErrorState,
  FilterSelect,
  formatDate,
  formatDateTime,
  formatMoney,
  FormError,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  ListDetail,
  LoadingRows,
  Money,
  PageHeader,
  PdfViewer,
  Paper,
  PaperLogo,
  PaperTitle,
  Pill,
  Stack,
  TextAreaField,
  TextField,
  Field,
  Timeline,
  toast,
  Toolbar,
  useContractForm,
  useIsPhone,
  useModal,
  type StatusTone,
  type TimelineItem,
} from "@mycity/ui";
import { OfferForm } from "./OfferForm";
import { OfferSettingsPanel } from "./OfferSettings";
import { SignForm } from "./OfferSign";
import { pill, say, sayRefusal } from "./shared";

export const OFFER_STATUS: Record<OfferStatus, [StatusTone, string]> = {
  draft: ["neutral", "Draft"],
  approval: ["warn", "With Approval"],
  approved: ["info", "Approved"],
  sent: ["warn", "With Candidate"],
  accepted: ["ok", "Accepted"],
  declined: ["err", "Declined"],
  expired: ["neutral", "Expired"],
  withdrawn: ["neutral", "Withdrawn"],
};
const STATUSES: Array<[string, string]> = [["", "All Statuses"], ...Object.entries(OFFER_STATUS).map(([k, [, t]]) => [k, t] as [string, string])];

const SCORE_HELP = "The candidate's weighted scorecard total when the offer was made.";
const RANGE_HELP = "The vacancy's monthly range. A total outside it needs a reason the approvers read.";

export function Offers() {
  const modal = useModal();
  const auth = useAuth();
  const mayCreate = auth.can("recruitment", "create");
  const mayEdit = auth.can("recruitment", "edit");
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const summary = useApi("GET /api/v1/recruitment/offers/summary");
  const list = usePaged("GET /api/v1/recruitment/offers", { filters: status ? { status: status as OfferStatus } : {} });
  const phone = useIsPhone();
  // Nothing opens unasked: a row opens its offer in the dialog, or the sheet on a phone (F31).
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked;

  const newOffer = (applicationId?: string) =>
    modal.open({ title: "New Offer", wide: true, full: true, body: (close) => <OfferForm applicationId={applicationId} close={close} onSaved={(o) => setPicked(o.offer_id)} /> });
  const settings = () => modal.open({ title: "Offer Settings", wide: true, body: (close) => <OfferSettingsPanel close={close} /> });
  useScreenAction(mayCreate ? { label: "New Offer", onSelect: () => newOffer() } : null);

  // A link opens what it names whenever it arrives, also while already on the tab, then leaves the
  // address in one step (two steps would each start from the address as it was).
  const linked = params.get("id");
  const wantsNew = params.get("new") === "1";
  const card = params.get("application");
  const panel = params.get("panel");
  const asked = params.get("status");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const ask = wantsNew ? `new:${card ?? ""}` : linked ? `id:${linked}` : card ? `app:${card}` : panel === "settings" ? "settings" : asked !== null ? `status:${asked}` : null;
    if (!ask) return void (opened.current = null);
    if (opened.current === ask) return;
    opened.current = ask;
    setParams({ id: null, new: null, application: null, panel: null, status: null }, { replace: true });
    if (asked !== null) setStatus(asked);
    if (wantsNew) return void (mayCreate && newOffer(card ?? undefined));
    if (linked) return void setPicked(linked);
    if (panel === "settings") return void (mayEdit && settings());
    if (!card) return;
    // The board's card names its application: its latest offer opens.
    api
      .call("GET /api/v1/recruitment/offers", { query: { application_id: card } })
      .then((p) => (p.data[0] ? setPicked(p.data[0].offer_id) : toast.error("No offer for this candidate yet")))
      .catch(say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, wantsNew, card, panel, asked]);

  const s = summary.data;
  const n = (v: number | undefined) => (v === undefined ? "–" : String(v));
  return (
    <>
      <PageHeader
        title="Offers"
        sub="Made, approved, signed and sent"
        actions={
          <>
            {/* The settings are Operations & People's: a team grant drafts offers but never configures them. */}
            {mayEdit && s?.can_configure && <Button icon="cog" onClick={settings}>Offer Settings</Button>}
            {mayCreate && <Button variant="primary" icon="plus" onClick={() => newOffer()}>New Offer</Button>}
          </>
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "With Approval", value: n(s?.with_approval), sub: s ? `${s.drafts} ${s.drafts === 1 ? "draft" : "drafts"}` : undefined, tone: s?.with_approval ? "warn" : undefined },
          { label: "To Send", value: n(s?.to_send), tone: s?.to_send ? "warn" : undefined },
          { label: "With Candidates", value: n(s?.with_candidates) },
          { label: "Accepted This Month", value: n(s?.accepted_this_month), tone: s?.accepted_this_month ? "ok" : undefined },
        ]}
      />
      <Toolbar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPicked(null);
          }}
          options={STATUSES}
        />
      </Toolbar>
      <ListDetail
        layout="modal"
        closeButton
        size="xl"
        full
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Offer"
        list={
          <PagedTable<OfferRow>
            title="Offers"
            list={list}
            search="Search offers"
            rowKey={(o) => o.offer_id}
            noun="offer"
            onRowClick={(o) => setPicked(o.offer_id)}
            empty={list.q || status ? undefined : { title: "No Offers Yet" }}
            columns={[
              { key: "number", label: "Offer", render: (o) => o.number, desktop: true },
              { key: "who", label: "Candidate", render: (o) => <span className={cn(o.offer_id === shown ? "font-semibold" : "font-medium")}>{o.candidate_name}</span> },
              { key: "role", label: "Role", render: (o) => o.job_title, desktop: true },
              { key: "start", label: "Start Date", desktop: true, render: (o) => (o.start_date ? formatDate(o.start_date) : "–") },
              {
                key: "pay",
                label: "Annual",
                align: "n",
                desktop: true,
                render: (o) => (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    <Money value={o.annual_compensation} />
                    {o.outside_range && <Pill tone="warn">Outside Range</Pill>}
                  </span>
                ),
              },
              { key: "status", label: "Status", render: (o) => pill(OFFER_STATUS[o.status]) },
              { key: "sent", label: "Sent", desktop: true, render: (o) => (o.sent_at ? formatDate(o.sent_at) : "–") },
              { key: "ends", label: "Expires", desktop: true, render: (o) => (o.expires_at ? formatDate(o.expires_at) : "–") },
            ]}
          />
        }
        // The dialog sets the cards side by side over the letter; a phone's sheet stacks them.
        detail={shown ? <OfferRecord key={shown} id={shown} onPicked={setPicked} wide={!phone} /> : null}
      />
    </>
  );
}

/**
 * One offer: its summary and actions, pay, approval and signers, then its history and the letter.
 * `wide` (the desktop dialog): the first four two by two, History and the letter across the dialog.
 */
export function OfferRecord({ id, onPicked, wide = false }: { id: string; onPicked?: (id: string) => void; wide?: boolean }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/recruitment/offers/:id", { params: { id } });
  const submit = useMutation("POST /api/v1/recruitment/offers/:id/submit");
  const send = useMutation("POST /api/v1/recruitment/offers/:id/send");
  const resend = useMutation("POST /api/v1/recruitment/offers/:id/resend");
  const o = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!o) return <Card><LoadingRows count={8} /></Card>;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/offers");
  };
  const step = (run: () => Promise<unknown>, said: string) => async () => {
    try {
      await run();
      reload();
      toast(said);
    } catch (e) {
      say(e);
    }
  };
  const body = { params: { id }, body: {} };
  const edit = () => modal.open({ title: "Edit Offer", wide: true, full: true, body: (close) => <OfferForm offer={o} close={close} onSaved={(x) => (reload(), onPicked?.(x.offer_id))} /> });
  const withdraw = () => modal.open({ title: "Withdraw Offer", body: (close) => <WithdrawForm offer={o} close={close} onSaved={reload} /> });
  const sign = () => modal.open({ title: "Sign for the Company", wide: true, body: (close) => <SignForm offer={o} close={close} onSaved={reload} /> });
  const viewLetter = () => modal.open({ title: `${o.number} · Offer Letter`, wide: true, body: <OfferLetter offer={o} /> });
  const changeEmail = () => modal.open({ title: "Change Email", body: (close) => <EmailForm offer={o} close={close} onSaved={reload} /> });
  const primary = "max-md:w-full";
  const signers =
    o.signers.length > 0 ? (
      <KeyValue
        items={o.signers.map((s) => [
          s.role === "mycity" ? `For the Company${s.title ? `, ${s.title}` : ""}` : "Candidate",
          <span key={s.name} className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {s.name}
            {s.status === "signed" ? pill(["ok", s.signed_at ? `Signed ${formatDate(s.signed_at)}` : "Signed"]) : s.status === "pending" ? pill(["warn", "Waiting"]) : pill(["neutral", s.status === "declined" ? "Declined" : "Not Signed"])}
          </span>,
        ])}
      />
    ) : null;

  return (
    <Stack>
      {o.send_refused_at && (
        <Banner tone="err" action={o.can_change_email ? <Button size="sm" onClick={changeEmail}>Change Email</Button> : undefined}>
          The offer email to {o.candidate_email} was refused on {formatDateTime(o.send_refused_at)}.
        </Banner>
      )}
      <Pair wide={wide}>
        <Card as="article">
        <CardHeader record title={o.candidate_name} right={pill(OFFER_STATUS[o.status])} />
        <KeyValue
          items={[
            ["Offer", o.number],
            ["Role", o.job_title],
            ["Department", o.department ?? "–"],
            ["Start Date", o.start_date ? formatDate(o.start_date) : "–"],
            ["Email", o.candidate_email],
            ...(o.expires_at ? [[o.status === "sent" ? "Expires" : "Expired On", formatDateTime(o.expires_at)] as [string, string]] : []),
            [<HelpTerm key="s" help={SCORE_HELP}>Score</HelpTerm>, o.score_snapshot === null ? "–" : o.score_snapshot.toFixed(1)],
            ...(o.end_reason ? [["Reason", <span key="r" data-copy="content">{o.end_reason}</span>] as [string, React.ReactNode]] : []),
          ]}
        />
        {wide && signers && (
          <section aria-labelledby={`signers-${id}`} className="mt-4 border-t border-border pt-4">
            <h3 id={`signers-${id}`} data-ui="title" className="mb-3 text-base font-strong text-foreground">
              Signers
            </h3>
            {signers}
          </section>
        )}
        <ActionGroup>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button icon="doc" onClick={viewLetter}>View Letter</Button>
            {o.can_withdraw && <Button variant="danger" onClick={withdraw}>Withdraw Offer</Button>}
            {o.can_edit && <Button icon="edit" onClick={edit}>Edit Offer</Button>}
            {o.can_change_email && <Button icon="mail" onClick={changeEmail}>Change Email</Button>}
            {o.can_resend && <Button icon="send" onClick={step(() => resend.run(body), "A new link is on its way")}>Resend Offer</Button>}
            {o.can_submit && <Button variant="primary" className={primary} onClick={step(() => submit.run(body), `${o.number} sent for approval`)}>Submit for Approval</Button>}
            {o.can_sign && <Button variant="primary" icon="signature" className={primary} onClick={sign}>Sign for Company</Button>}
            {o.can_send && <Button variant="primary" icon="send" className={primary} onClick={step(() => send.run(body), `${o.number} sent to ${o.candidate_name.split(" ")[0]}`)}>Send Offer</Button>}
          </div>
        </ActionGroup>
      </Card>
      {/* In the dialog the approval sits under Monthly Pay, in the same card; a phone's sheet keeps its own card. */}
      {wide ? (
        <PayCard o={o}>{o.workflow_instance_id && <OfferApproval instanceId={o.workflow_instance_id} onDecided={reload} inCard />}</PayCard>
      ) : (
        <>
          <PayCard o={o} />
          {o.workflow_instance_id && <OfferApproval instanceId={o.workflow_instance_id} onDecided={reload} />}
        </>
      )}
      {/* In the dialog the signers sit in the offer's own card; a phone's sheet keeps their card. */}
      {!wide && signers && (
        <Card>
          <CardHeader title="Signers" />
          {signers}
        </Card>
      )}
      </Pair>
      <Card>
        <CardHeader title="History" />
        <Timeline label="History" items={historyOf(o)} />
      </Card>
    </Stack>
  );
}

const MOCK = import.meta.env.VITE_API_MODE === "mock";

/**
 * View Letter: the offer's PDF as the candidate receives it, with Open in Tab and Download PDF, as a
 * query's letter is shown (M3). Before the PDF is made (a draft), and on the mock, the letter's
 * wording on paper.
 */
function OfferLetter({ offer: o }: { offer: OfferDetail }) {
  const pdf = useFileBlob(o.document && !MOCK ? `/api/v1/recruitment/offers/${o.offer_id}/document` : null);
  if (o.document && !MOCK) {
    if (pdf.failed) return <EmptyState bare icon="doc" title="Letter Not Ready" text="It is still being made. Try again shortly." />;
    if (!pdf.blob || !pdf.href) return <PdfViewer data={null} name={o.document.file_name} height="page" />;
    return (
      <DocumentPreview
        name={o.document.file_name}
        mime="application/pdf"
        href={pdf.href}
        file={pdf.blob}
        height="page"
        actions={<Button size="sm" icon="download" onClick={() => saveBlob(pdf.blob!, o.document!.file_name)}>Download PDF</Button>}
      />
    );
  }
  return (
    <Paper>
      <PaperLogo reference={o.number} />
      <PaperTitle sub={`${o.candidate_name}, ${o.job_title}`}>Offer of Employment</PaperTitle>
      <div data-copy="content">
        {o.letter.slice(1).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </Paper>
  );
}

/** The record's first cards: two by two in the desktop dialog, each at its own height; one under another in a phone's sheet. */
function Pair({ wide, children }: { wide: boolean; children: React.ReactNode }) {
  return wide ? <Grid cols={2} scroll={false} flush>{children}</Grid> : <>{children}</>;
}

/** The monthly pay, line by line, the total and the year, against the vacancy's range; in the dialog, the approval under it. */
function PayCard({ o, children }: { o: OfferDetail; children?: React.ReactNode }) {
  const range = o.salary_min || o.salary_max ? `${o.salary_min ? formatMoney(o.salary_min) : "Any"} to ${o.salary_max ? formatMoney(o.salary_max) : "Any"}` : null;
  return (
    <Card>
      <CardHeader title="Monthly Pay" right={o.outside_range ? <Pill tone="warn">Outside Range</Pill> : undefined} />
      <KeyValue
        items={[
          ...o.pay_lines.map((l) => [l.name, <Money key={l.offer_pay_line_id} value={l.monthly_amount} />] as [string, React.ReactNode]),
          ["Monthly Total", <b key="t"><Money value={o.monthly_total} /></b>],
          ["Annual", <Money key="a" value={o.annual_compensation} />],
          ...(range ? [[<HelpTerm key="h" help={RANGE_HELP}>Vacancy Range</HelpTerm>, range] as [React.ReactNode, string]] : []),
          ...(o.outside_range && o.range_reason ? [["Why Outside", <span key="w" data-copy="content">{o.range_reason}</span>] as [string, React.ReactNode]] : []),
        ]}
      />
      {children}
    </Card>
  );
}

/** The offer's way so far, from its own dates: made, submitted, approved, signed, sent, and how it ended. */
function historyOf(o: OfferDetail): TimelineItem[] {
  const company = o.signers.find((s) => s.role === "mycity");
  const items: Array<TimelineItem & { at: string }> = [
    { at: o.created_at, title: "Offer made", when: formatDateTime(o.created_at), tone: "done" },
    ...(o.submitted_at ? [{ at: o.submitted_at, title: "Submitted for approval", when: formatDateTime(o.submitted_at), tone: "done" as const }] : []),
    ...(o.approved_at ? [{ at: o.approved_at, title: "Approved", when: formatDateTime(o.approved_at), tone: "done" as const }] : []),
    ...(company?.signed_at ? [{ at: company.signed_at, title: `Signed for the company by ${company.name}`, when: formatDateTime(company.signed_at), tone: "done" as const }] : []),
    ...(o.sent_at ? [{ at: o.sent_at, title: "Sent to the candidate", when: formatDateTime(o.sent_at), tone: "done" as const }] : []),
    ...(o.accepted_at ? [{ at: o.accepted_at, title: "Accepted and signed", when: formatDateTime(o.accepted_at), tone: "done" as const }] : []),
    ...(o.declined_at ? [{ at: o.declined_at, title: "Declined", when: formatDateTime(o.declined_at), text: o.end_reason ?? undefined }] : []),
    ...(o.withdrawn_at ? [{ at: o.withdrawn_at, title: "Withdrawn", when: formatDateTime(o.withdrawn_at), text: o.end_reason ?? undefined }] : []),
    ...(o.status === "expired" && o.expires_at ? [{ at: o.expires_at, title: "Expired unsigned", when: formatDateTime(o.expires_at) }] : []),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at)).map(({ at: _at, ...item }) => item);
}

const MOVE: Record<string, (who: string) => string> = {
  approve: (who) => `Approved by ${who}`,
  reject: (who) => `Rejected by ${who}`,
  request_changes: (who) => `Changes asked by ${who}`,
  cancel: () => "Withdrawn",
  timeout_approve: () => "Approved when time ran out",
  timeout_reject: () => "Rejected when time ran out",
  reassign: (who) => `Passed on by ${who}`,
};

/**
 * The offer's approval: its stages, each move with its reason, and Approve and Reject for whom it waits on.
 * Its own card, or (`inCard`) a part of Monthly Pay's under a hairline.
 */
function OfferApproval({ instanceId, onDecided, inCard = false }: { instanceId: string; onDecided: () => void; inCard?: boolean }) {
  const modal = useModal();
  const flow = useApi("GET /api/v1/workflow/instances/:id", { params: { id: instanceId } });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const f = flow.data;
  const done = () => {
    flow.reload();
    onDecided();
    invalidate("/api/v1/workflow/mine");
  };
  const yes = async () => {
    try {
      await approve.run({ params: { id: instanceId }, body: {} });
      done();
      toast("Offer approved");
    } catch (e) {
      say(e);
    }
  };
  const no = () => modal.open({ title: "Reject Offer", body: (close) => <RejectForm instanceId={instanceId} close={close} onSaved={done} /> });
  const body = (
    <>
      {f ? (
        <>
          <Chain steps={f.route.map((s) => ({ label: s.name, state: s.state === "done" || s.state === "now" ? s.state : undefined }))} />
          {f.decisions.length > 0 && (
            <Timeline
              className="mt-3"
              items={f.decisions.map((d) => ({
                title: (MOVE[d.decision] ?? MOVE.approve!)(d.actor_name ?? d.stage_name ?? "People"),
                when: formatDateTime(d.decided_at),
                text: d.reason ?? undefined,
                tone: d.decision === "approve" ? ("done" as const) : undefined,
              }))}
            />
          )}
          {f.can_decide && (
            <ActionGroup>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="danger" onClick={no}>Reject Offer</Button>
                <Button variant="primary" className="max-md:w-full" onClick={yes}>Approve Offer</Button>
              </div>
            </ActionGroup>
          )}
        </>
      ) : flow.error ? (
        <ErrorState error={flow.error} onRetry={flow.reload} />
      ) : (
        <LoadingRows count={2} />
      )}
    </>
  );
  if (inCard)
    return (
      <section aria-labelledby={`approval-${instanceId}`} className="mt-4 border-t border-border pt-4">
        <h3 id={`approval-${instanceId}`} data-ui="title" className="mb-3 text-base font-strong text-foreground">
          Approval
        </h3>
        {body}
      </section>
    );
  return (
    <Card>
      <CardHeader title="Approval" />
      {body}
    </Card>
  );
}

function RejectForm({ instanceId, close, onSaved }: { instanceId: string; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ reason: "" }, offerSchemas.OfferWithdraw);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await reject.run({ params: { id: instanceId }, body: f.values });
      close();
      onSaved();
      toast("Offer back with its owner");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={save}>Reject Offer</Button>
      </FormFooter>
    </>
  );
}

/** Change Email: the candidate's address corrected, and a fresh link sent to it. */
function EmailForm({ offer, close, onSaved }: { offer: OfferDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ email: offer.candidate_email }, offerSchemas.OfferRecipient);
  const run = useMutation("POST /api/v1/recruitment/offers/:id/recipient");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: offer.offer_id }, body: f.values });
      close();
      onSaved();
      toast("A new link is on its way");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Email" {...f.status("email")}>
        <TextField {...f.field("email")} placeholder="name@example.com" autoComplete="off" />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>Send to Email</Button>
      </FormFooter>
    </>
  );
}

function WithdrawForm({ offer, close, onSaved }: { offer: OfferDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ reason: "" }, offerSchemas.OfferWithdraw);
  const run = useMutation("POST /api/v1/recruitment/offers/:id/withdraw");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id: offer.offer_id }, body: f.values });
      close();
      onSaved();
      toast(`${offer.number} withdrawn`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Keep Offer</Button>
        <Button variant="danger" onClick={save}>Withdraw Offer</Button>
      </FormFooter>
    </>
  );
}
