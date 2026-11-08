import { useEffect } from "react";
import type { ProposalDetail, ProposalRow } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import { useTrailTitle } from "@/lib/trail";
import {
  ActionGroup,
  Banner,
  Button,
  Card,
  DocumentFrame,
  formatMoneyShort,
  formatWhen,
  ListDetail,
  LoadingRows,
  Menu,
  PageHeader,
  StatusPill,
  StepBar,
  toast,
  useConfirm,
  useIsPhone,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";
import { fail, useMay } from "./lib";
import { Brief } from "./studio/Brief";
import { Draft } from "./studio/Draft";
import { Edit } from "./studio/Edit";
import { Questions } from "./studio/Questions";
import { DeclineProposal, downloadPdf, SaveTemplate, SendProposal } from "./studio/Send";

type Status = ProposalRow["status"];
const PILL: Record<Status, { tone: "ok" | "warn" | "err" | "info" | "neutral"; text: string }> = {
  brief: { tone: "neutral", text: "Brief" },
  questions: { tone: "info", text: "Questions" },
  writing: { tone: "info", text: "Writing" },
  draft: { tone: "neutral", text: "Draft" },
  sent: { tone: "info", text: "Sent" },
  viewed: { tone: "warn", text: "Viewed" },
  accepted: { tone: "ok", text: "Accepted" },
  declined: { tone: "err", text: "Declined" },
  expired: { tone: "neutral", text: "Expired" },
  withdrawn: { tone: "neutral", text: "Withdrawn" },
};
const STEPS = ["Brief", "Questions", "Draft", "Edit", "Send"] as const;
const stepOf = (s: Status) => (s === "brief" ? 0 : s === "questions" ? 1 : s === "writing" ? 2 : s === "draft" ? 3 : 4);

/** One proposal in the studio: the step it is at, its pages and what a person may do now. */
function Studio({ id }: { id: string }) {
  const phone = useIsPhone();
  const modal = useModal();
  const confirm = useConfirm();
  const d = useApi("GET /api/v1/partnerships/proposals/:id", { params: { id } });
  const p = d.data;
  const hasPages = Boolean(p && p.content);
  const preview = useApi("GET /api/v1/partnerships/proposals/:id/preview", { params: { id }, enabled: hasPages });
  const accept = useMutation("POST /api/v1/partnerships/proposals/:id/accept");
  const withdraw = useMutation("POST /api/v1/partnerships/proposals/:id/withdraw");
  const revise = useMutation("POST /api/v1/partnerships/proposals/:id/revise");
  const byHand = useMutation("POST /api/v1/partnerships/proposals/:id/draft");
  const { navigate } = useRouter();
  useTrailTitle(p ? `${p.number} ${p.record.name}` : null);
  const done = (next: ProposalDetail) => {
    d.set(next);
    invalidate(`/api/v1/partnerships/proposals/${id}`);
  };
  if (d.error) return <Banner tone="err" action={<Button size="sm" onClick={d.reload}>Try Again</Button>}>This proposal did not load</Banner>;
  if (!p) return <Card><LoadingRows count={6} /></Card>;

  const send = () => modal.open({ title: "Send Proposal", full: phone, wide: true, body: (close) => <SendProposal p={p} preview={preview.data ?? null} close={close} done={done} /> });
  const act = async (work: () => Promise<ProposalDetail>, said: string) => {
    try {
      done(await work());
      invalidate("/api/v1/partnerships/proposals");
      toast(said);
    } catch (e) {
      fail(e);
    }
  };
  const copy = async () => {
    if (!p.link_url) return;
    await navigator.clipboard.writeText(p.link_url);
    toast("Link copied");
  };
  const menu = [
    { label: "Download PDF", icon: "download" as const, onSelect: () => downloadPdf(p) },
    ...(p.link_url ? [{ label: "Copy Link", icon: "copy" as const, onSelect: copy }] : []),
    ...(p.can.decide ? [{ label: "Mark Declined", icon: "thumbdown" as const, onSelect: () => modal.open({ title: "Mark Declined", body: (close) => <DeclineProposal p={p} close={close} done={done} /> }) }] : []),
    ...(p.can.withdraw
      ? [
          {
            label: "Withdraw",
            icon: "x" as const,
            danger: true,
            onSelect: async () => {
              if (await confirm({ title: "Withdraw Proposal", confirmLabel: "Withdraw", destructive: true }))
                await act(() => withdraw.run({ params: { id }, body: {} }), "Proposal withdrawn");
            },
          },
        ]
      : []),
    ...(p.can.save_template ? [{ label: "Save as Template", icon: "copy" as const, onSelect: () => modal.open({ title: "Save as Template", body: (close) => <SaveTemplate p={p} close={close} /> }) }] : []),
  ];

  const step = stepOf(p.status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground" data-copy="content">{p.title ?? p.deal_title}</h2>
          <p className="text-sm text-muted-foreground" data-copy="content">{`${p.number}${p.version > 1 ? ` v${p.version}` : ""} · ${p.record.name}`}</p>
        </div>
        <StatusPill status={PILL[p.status]} />
      </div>
      <StepBar steps={STEPS} at={step} complete={step === 4 && p.status !== "draft"} />
      <ActionGroup>
        <div className="flex flex-wrap items-center gap-2">
          {p.can.send && (
            <Button variant="primary" icon="send" onClick={send}>
              Send Proposal
            </Button>
          )}
          {p.can.decide && (
            <Button variant="primary" icon="thumb" onClick={() => act(() => accept.run({ params: { id }, body: {} }), "Proposal marked accepted")}>
              Mark Accepted
            </Button>
          )}
          {p.can.revise && (
            <Button
              icon="edit"
              onClick={() =>
                act(async () => {
                  const next = await revise.run({ params: { id }, body: {} });
                  navigate(`/partnerships?tab=proposals&id=${next.partnership_proposal_id}`);
                  return next;
                }, "New version started")
              }
            >
              Revise
            </Button>
          )}
          {hasPages && <Menu label="More" align="end" trigger={<Button icon="dots">More</Button>} items={menu} />}
        </div>
      </ActionGroup>
      {p.status === "accepted" && <Banner tone="ok" action={<Button size="sm" onClick={() => navigate(`/partnerships?tab=${p.record.type === "partner" ? "partners" : "leads"}&id=${p.record.id}`)}>Open Deal</Button>}>Accepted. Move the deal on its 360.</Banner>}
      {(p.progress || p.status === "writing") && <Draft p={p} reload={d.reload} done={done} />}
      {p.status === "questions" && !p.progress && <Questions p={p} done={done} />}
      {p.status === "questions" && p.progress?.failed && (p.progress.reason === "off" || p.progress.reason === "limit") && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => act(() => byHand.run({ params: { id }, body: {} }), "Draft ready to fill")}>
            Build by Hand
          </Button>
        </div>
      )}
      {hasPages && p.status === "draft" && preview.data && <Edit p={p} preview={preview.data} done={done} />}
      {hasPages && p.status !== "draft" && preview.data && <DocumentFrame title={`Proposal ${p.number}`} html={preview.data.html} />}
      {hasPages && !preview.data && <Card><LoadingRows count={4} /></Card>}
    </div>
  );
}

/**
 * Partnerships · Proposals (#53, docs/guides/partnerships.md §2, §6.10, §10): the proposal list beside
 * the proposal in the studio (`?id=`), side by side on a wide desktop and in a full sheet on a phone
 * (F31). New Proposal opens the brief; a 360's New Proposal arrives as `?new=<lead or partner>`.
 */
export function Proposals({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const beside = useSideBySide();
  const { location, navigate } = useRouter();
  const mayCreate = useMay("create");
  const s = useApi("GET /api/v1/partnerships/proposals/summary");
  const list = usePaged("GET /api/v1/partnerships/proposals", { sort: "-created_at" });
  const openProposal = (pid: string) => navigate(`/partnerships?tab=proposals&id=${pid}`);
  const brief = (record: { type: "lead" | "partner"; id: string } | null) =>
    modal.open({ title: "New Proposal", wide: true, full: phone, body: (close) => <Brief record={record} close={close} opened={(p) => openProposal(p.partnership_proposal_id)} /> });
  const newProposal = () => brief(null);
  useScreenAction(mayCreate ? { label: "New Proposal", onSelect: newProposal } : null);
  useNewLink(mayCreate ? newProposal : null);
  const preset = location.params.get("new");
  const kind = location.params.get("record") === "lead" ? "lead" : "partner";
  useEffect(() => {
    if (!preset) return;
    navigate("/partnerships?tab=proposals", { replace: true });
    brief({ type: kind, id: preset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  const shown = id ?? (beside ? (list.rows[0]?.partnership_proposal_id ?? null) : null);
  return (
    <>
      <PageHeader title="Proposals" sub="Written with Claude, sent by you" actions={mayCreate ? <Button variant="primary" icon="plus" onClick={newProposal}>New Proposal</Button> : undefined} />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Sent This Year", value: String(s.data.sent_this_year) },
            { label: "Viewed, No Reply", value: String(s.data.viewed_no_reply), tone: s.data.viewed_no_reply ? "warn" : undefined },
            ...(phone ? [] : [{ label: "Accepted", value: String(s.data.accepted), tone: "ok" as const }, { label: "Acceptance Rate", value: s.data.acceptance_rate === null ? "None" : `${s.data.acceptance_rate}%` }]),
          ]}
        />
      )}
      <ListDetail
        open={Boolean(id)}
        onClose={() => navigate("/partnerships?tab=proposals")}
        title="Proposal"
        cols="1/1.5"
        full
        list={
          <PagedTable<ProposalRow>
            title="Proposals"
            list={list}
            search="Search proposals"
            rowKey={(p) => p.partnership_proposal_id}
            noun="proposal"
            onRowClick={(p) => openProposal(p.partnership_proposal_id)}
            empty={{ title: "No Proposals Yet", text: "Start one from a deal." }}
            columns={[
              { key: "t", label: "Proposal", render: (p) => <Who name={p.title ?? p.deal_title} sub={p.number} /> },
              { key: "p", label: "Partner", render: (p) => p.record.name, desktop: true },
              { key: "v", label: "Value", align: "n", render: (p) => (p.value ? formatMoneyShort(p.value) : "None"), desktop: true },
              { key: "s", label: "Status", render: (p) => <StatusPill status={PILL[p.status]} /> },
              { key: "w", label: "Viewed", render: (p) => (p.first_viewed_at ? formatWhen(p.first_viewed_at) : "Not Yet"), desktop: true },
            ]}
          />
        }
        detail={shown && <Studio key={shown} id={shown} />}
      />
    </>
  );
}
