import type { AgreementDetail, AgreementRow, AgreementStatus } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { saveFile } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  ActionGroup,
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  Chips,
  DataView,
  DesktopOnly,
  formatDate,
  formatDateTime,
  formatMoney,
  HelpTerm,
  KeyValue,
  ListDetail,
  Menu,
  PageHeader,
  Paper,
  PhoneOnly,
  Pill,
  RichText,
  StatusPill,
  useIsPhone,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";
import { CloseAgreement, EditDraft, GenerateAgreement, RecordSignedCopy, RenewAgreement, SendForSignature } from "./forms/AgreementForms";
import { agreementPill, fail, KIND_LABEL, SIGNER_STATE, useMay } from "./lib";
import { useOpenWhereNews, useViewNews, withNews } from "@/features/notifications/marks";
import { RecordState } from "./record";

type View = "all" | AgreementStatus;

const VIEWS: Array<[View, string]> = [
  ["all", "All"],
  ["draft", "Draft"],
  ["review", "In Review"],
  ["approval", "In Approval"],
  ["sent", "Sent"],
  ["active", "Active"],
  ["expiring", "Expiring"],
  ["closed", "Closed"],
];

/** The lifecycle as the bar draws it (§6.8): where this agreement is. */
const STEPS: Array<[AgreementStatus, string]> = [
  ["draft", "Draft"],
  ["review", "Review"],
  ["approval", "Approval"],
  ["sent", "Sent"],
  ["viewed", "Viewed"],
  ["signed", "Signed"],
  ["active", "Active"],
  ["expiring", "Expiring"],
  ["renewed", "Renewed"],
];

const RENEWAL_HELP = "The owner is reminded this many days before it ends, then 30, 7 and 1 days before.";

/**
 * Partnerships · Contracts & MOUs (#54, docs/guides/partnerships.md §6.8, §6.9, §10.1, §10.2): the KPI strip,
 * the agreements beside the picked one (side by side on a wide desktop, a sheet on a phone, F31) with its
 * lifecycle bar (desktop only), its wording, approval, signers, reference and QR, renewal, and each step.
 */
export function Contracts({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const beside = useSideBySide();
  const { navigate } = useRouter();
  const mayCreate = useMay("create");
  const [view, setView] = useState<View>("all");
  const s = useApi("GET /api/v1/partnerships/agreements/summary");
  const list = usePaged("GET /api/v1/partnerships/agreements", { filters: view === "all" ? {} : { status: view } });
  // Where news waits (notifications.md §6): each chip carries its share; it opens where the news is.
  const news = useViewNews();
  useOpenWhereNews({ value: view, onChange: setView, values: VIEWS.map(([v]) => v), all: "all", skip: Boolean(id) });
  const openOne = (aid: string) => navigate(`/partnerships?tab=contracts-and-mous&id=${aid}`);
  const generate = () => modal.open({ title: "Generate Agreement", body: (close) => <GenerateAgreement close={close} onCreated={openOne} /> });
  useScreenAction(mayCreate ? { label: "Generate Agreement", onSelect: generate } : null);
  useNewLink(mayCreate ? generate : null);
  const shown = id ?? (beside ? (list.rows[0]?.partnership_agreement_id ?? null) : null);
  return (
    <>
      <PageHeader
        title="Contracts & MOUs"
        sub="Agreements from draft to renewal"
        actions={mayCreate && <Button variant="primary" icon="plus" onClick={generate}>Generate Agreement</Button>}
      />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            ...(phone ? [] : [{ label: "Active", value: String(s.data.active), tone: "ok" as const }, { label: "In Approval", value: String(s.data.in_approval), tone: s.data.in_approval ? ("warn" as const) : undefined }]),
            { label: "Awaiting Signature", value: String(s.data.awaiting_signature) },
            { label: "Renewals 180 Days", value: String(s.data.renewals_180), tone: s.data.renewals_180 ? "warn" : undefined, help: "Signed agreements whose renewal date falls in the next 180 days." },
          ]}
        />
      )}
      <Chips label="Agreements" value={view} onChange={setView} options={withNews(news, VIEWS, { all: "all" })} className="mt-3" />
      <ListDetail
        open={Boolean(id)}
        onClose={() => navigate("/partnerships?tab=contracts-and-mous")}
        title="Agreement"
        cols="1/1.5"
        full
        list={
          <PagedTable<AgreementRow>
            title="Agreements"
            list={list}
            search="Search agreements"
            rowKey={(a) => a.partnership_agreement_id}
            noun="agreement"
            onRowClick={(a) => openOne(a.partnership_agreement_id)}
            empty={{ title: "No Agreements Yet", text: "Generate one from a deal." }}
            columns={[
              { key: "a", label: "Agreement", render: (a) => <Who name={a.title} sub={a.number} /> },
              { key: "p", label: "Partner", render: (a) => a.record.name, desktop: true },
              { key: "k", label: "Kind", render: (a) => (a.kind ? KIND_LABEL[a.kind] : "None"), desktop: true },
              { key: "s", label: "Status", render: (a) => <StatusPill status={agreementPill(a.status)} /> },
              { key: "r", label: "Renewal", render: (a) => (a.renewal_on ? formatDate(a.renewal_on) : "None") },
            ]}
          />
        }
        detail={shown && <AgreementPanel key={shown} id={shown} onOpen={openOne} />}
      />
    </>
  );
}

/** The step a person takes next, by where the agreement is: the primary button, at the foot on a phone. */
function nextOf(a: AgreementDetail): "edit" | "submit" | "send" | "again" | "renew" | null {
  if (a.status === "draft") return a.missing_fields.length || !a.starts_on ? "edit" : "submit";
  if (a.status === "approval" && a.approval?.state === "approved") return "send";
  if (a.status === "sent" || a.status === "viewed") return "again";
  if (a.status === "signed" || a.status === "active" || a.status === "expiring") return "renew";
  return null;
}

const NEXT_LABEL = { edit: "Edit Draft", submit: "Submit for Approval", send: "Send for Signature", again: "Send Again", renew: "Renew" } as const;

/** One agreement whole: its step, its wording, approval, signers, reference and renewal. */
function AgreementPanel({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const modal = useModal();
  const mayEdit = useMay("edit");
  const r = useApi("GET /api/v1/partnerships/agreements/:id", { params: { id } });
  const submit = useMutation("POST /api/v1/partnerships/agreements/:id/submit");
  useTrailTitle(r.data?.number);
  if (!r.data) return <RecordState loading={r.loading} error={r.error} onRetry={r.reload} />;
  const a = r.data;
  const open = (title: string, body: (close: () => void) => JSX.Element, wide = false) => modal.open({ title, wide, body });
  const approved = a.approval?.state === "approved";
  const ended = a.signing && ["declined", "expired"].includes(a.signing.status);
  const next = mayEdit ? nextOf(a) : null;
  const run = async (step: NonNullable<ReturnType<typeof nextOf>>) => {
    if (step === "edit") return open("Edit Draft", (close) => <EditDraft a={a} close={close} />, true);
    if (step === "send") return open("Send for Signature", (close) => <SendForSignature a={a} close={close} />);
    if (step === "again") return open("Send Again", (close) => <SendForSignature a={a} again close={close} />);
    if (step === "renew") return open("Renew Agreement", (close) => <RenewAgreement a={a} close={close} onCreated={onOpen} />);
    try {
      await submit.run({ params: { id: a.partnership_agreement_id }, body: {} });
      invalidate("/api/v1/partnerships/agreements");
    } catch (e) {
      fail(e);
    }
  };
  const doc = a.signed_document ?? a.document;
  const menu = [
    ...(a.status === "draft" && next !== "edit" ? [{ label: "Edit Draft", icon: "doc" as const, onSelect: () => run("edit") }] : []),
    ...(approved || a.status === "sent" || a.status === "viewed" ? [{ label: "Record Signed Copy", icon: "clip" as const, onSelect: () => open("Record Signed Copy", (close) => <RecordSignedCopy a={a} close={close} />) }] : []),
    ...(a.status === "sent" || a.status === "viewed" ? [{ label: "Correct Signers", icon: "forward" as const, onSelect: () => open("Send Again", (close) => <SendForSignature a={a} again close={close} />) }] : []),
    ...(doc ? [{ label: "Download PDF", icon: "download" as const, onSelect: () => saveFile(`/api/v1/partnerships/agreements/${a.partnership_agreement_id}/document`, doc.file_name) }] : []),
    ...(a.status !== "closed" ? [{ label: "Close Agreement", danger: true, onSelect: () => open("Close Agreement", (close) => <CloseAgreement a={a} close={close} />) }] : []),
  ];
  const at = STEPS.findIndex(([s]) => s === a.status);
  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader
          title={a.number}
          right={
            <ActionGroup>
              {menu.length > 0 && <Menu label="Agreement Actions" trigger={<Button icon="dots">More</Button>} items={menu} />}
              {next && (
                <DesktopOnly>
                  <Button variant="primary" onClick={() => run(next)}>{NEXT_LABEL[next]}</Button>
                </DesktopOnly>
              )}
            </ActionGroup>
          }
        />
        <p className="text-md font-semibold text-foreground" data-copy="content">{a.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={agreementPill(a.status, approved)} />
          {a.kind && <Pill>{KIND_LABEL[a.kind]}</Pill>}
          <Pill>{a.record.name}</Pill>
          {a.signed_outside && <Pill>Signed Outside the Hub</Pill>}
        </div>
        {a.status !== "closed" && at >= 0 && (
          <DesktopOnly>
            <Chain className="mt-3" label="Agreement lifecycle" steps={STEPS.map(([, label], i) => ({ label, state: i < at ? "done" : i === at ? "now" : undefined }))} />
          </DesktopOnly>
        )}
      </Card>

      {a.returned_reason && <Banner tone="warn" icon="info">{`Returned: ${a.returned_reason}`}</Banner>}
      {a.status === "draft" && a.missing_fields.length > 0 && <Banner tone="info" icon="info">{`Fill ${a.missing_fields.join(", ")} before you submit.`}</Banner>}
      {ended && <Banner tone="warn" icon="info">{a.signing!.status === "declined" ? `Declined: ${a.signing!.end_reason ?? "No reason given"}` : "Not signed in time. Send it again."}</Banner>}
      {a.status === "closed" && a.close_reason && <Banner tone="info" icon="info">{`Closed: ${a.close_reason}`}</Banner>}

      {a.approval && (
        <Card>
          <CardHeader title="Approval" />
          <KeyValue items={a.approval.state === "approved" ? [["Status", "Approved"]] : [["Stage", a.approval.stage ?? "None"], ["Waiting On", a.approval.waiting_on ?? "Nobody named"]]} />
        </Card>
      )}

      {a.signers.length > 0 && (
        <DataView
          title="Signers"
          rows={a.signers}
          rowKey={(s) => `${s.side}:${s.name}`}
          columns={[
            { key: "n", label: "Signer", render: (s) => <Who name={s.name} sub={s.title ?? (s.side === "mycity" ? "MyCity" : a.record.name)} /> },
            { key: "s", label: "State", render: (s) => <StatusPill status={{ tone: SIGNER_STATE[s.state].tone, text: SIGNER_STATE[s.state].label }} /> },
            { key: "w", label: "Signed", render: (s) => (s.signed_at ? formatDateTime(s.signed_at) : "Not yet") },
          ]}
        />
      )}

      {a.verify && (
        <Card>
          <CardHeader title="Reference and QR" />
          <div className="flex items-center gap-3">
            <img src={a.verify.qr} alt={`QR code for ${a.verify.reference}`} className="size-24 rounded-box" />
            <KeyValue items={[["Reference", a.verify.reference], ["Verify At", <a key="v" href={a.verify.url} target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline">{a.verify.url.replace(/^https?:\/\//, "")}</a>]]} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Term and Renewal" />
        <KeyValue
          items={[
            ["Starts", a.starts_on ? formatDate(a.starts_on) : "Not set"],
            ["Ends", a.ends_on ? formatDate(a.ends_on) : "Open ended"],
            [<HelpTerm key="r" help={RENEWAL_HELP}>Renewal</HelpTerm>, a.renewal_on ? formatDate(a.renewal_on) : "None"],
            ["Value", a.value ? formatMoney(a.value) : "None"],
            ...(a.signed_at ? ([["Signed", formatDateTime(a.signed_at)]] as Array<[string, string]>) : []),
          ]}
        />
      </Card>

      <Paper>
        <RichText blocks={a.blocks} top={3} />
      </Paper>

      {next && (
        <PhoneOnly>
          <Button variant="primary" className="w-full" onClick={() => run(next)}>{NEXT_LABEL[next]}</Button>
        </PhoneOnly>
      )}
    </div>
  );
}
