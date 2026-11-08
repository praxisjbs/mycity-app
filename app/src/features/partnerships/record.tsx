import type { Contact, CustomValues, DealDetail, Field as CustomField, Interaction, RecordHistoryLine, StageHistoryLine } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { PagedTable } from "@/features/shared/sections";
import { hrefFor } from "@/lib/routes";
import { Link } from "@/lib/router";
import { Button, Card, CardHeader, DataView, Details, EmptyState, formatDate, formatDateTime, formatMoney, HelpTerm, KeyValue, LoadingRows, PhoneOnly, Pill, StageSwitcher, StatusPill, Timeline, toast, useModal } from "@mycity/ui";
import { ContactForm } from "./forms/ContactForm";
import { DealForm } from "./forms/DealForm";
import { MoveStage } from "./forms/MoveStage";
import { SetHealth } from "./forms/SetHealth";
import { UploadDocument } from "./forms/UploadDocument";
import { fail, healthPill, MEANING_LABEL, moveNeeds, nextStage, useStages } from "./lib";

/**
 * What both 360s are built from (docs/guides/partnerships.md §6.2, §10.1): a deal with its stage
 * switcher, health, blockers, next action and expected close; and the Activity, Documents, Contacts,
 * Work and Details tabs. The stage moves only here (no board, §6.5).
 */

export type RecordKey = { type: "lead" | "partner"; id: string };

/** The stage switcher's press: straight through, or the Why sheet and the signed copy when the move needs them. */
export function useMover(deal: DealDetail | null) {
  const modal = useModal();
  const { stages } = useStages();
  const move = useMutation("POST /api/v1/partnerships/deals/:id/stage");
  return (code: string) => {
    if (!deal) return;
    const needs = moveNeeds(stages, deal, code);
    if (!needs.to) return;
    if (needs.refused) return toast(needs.refused);
    if (needs.reason || needs.copy) {
      const to = needs.to;
      modal.open({ title: needs.copy ? "Attach Signed Copy" : `Move to ${to.label}`, body: (close) => <MoveStage deal={deal} to={to} reason={needs.reason} copy={needs.copy} close={close} /> });
      return;
    }
    return move
      .run({ params: { id: deal.deal_id }, body: { stage: code } })
      .then(() => {
        invalidate("/api/v1/partnerships");
        toast(`Moved to ${needs.to!.label}`);
      })
      .catch(fail);
  };
}

/** The phone's Next Stage, full width at the foot of the record (§10.2). */
export function NextStage({ deal, readOnly }: { deal: DealDetail | null; readOnly?: boolean }) {
  const { stages } = useStages();
  const onMove = useMover(deal);
  const next = deal && !readOnly ? nextStage(stages, deal.stage) : null;
  if (!next) return null;
  return (
    <PhoneOnly className="mt-3">
      <Button variant="primary" className="w-full" icon="forward" aria-label={`Move to ${next.label}`} onClick={() => onMove(next.code)}>
        Next Stage
      </Button>
    </PhoneOnly>
  );
}

/**
 * One deal on a 360's Overview: its stages, health, blockers, next action and expected close.
 * `categoryId` is its lead's or partner's: Edit Deal reads the category's defaults and custom fields.
 */
export function DealPanel({ deal, readOnly, money, categoryId }: { deal: DealDetail; readOnly?: boolean; money?: boolean; categoryId?: string | null }) {
  const modal = useModal();
  const { stages } = useStages();
  const onMove = useMover(deal);
  // A retired stage the deal still sits at keeps its place in the switcher.
  const shown = stages.some((s) => s.code === deal.stage) ? stages : [...stages, { code: deal.stage, label: deal.stage_label }];
  return (
    <Card>
      <CardHeader
        title={deal.title}
        record
        right={
          readOnly ? undefined : (
            <span className="flex gap-2">
              <Button size="sm" onClick={() => modal.open({ title: "Set Health", body: (close) => <SetHealth deal={deal} close={close} /> })}>Set Health</Button>
              <Button size="sm" onClick={() => modal.open({ title: "Edit Deal", wide: true, body: (close) => <DealForm deal={deal} categoryId={categoryId ?? null} close={close} /> })}>Edit Deal</Button>
            </span>
          )
        }
      />
      <StageSwitcher label={`Stage of ${deal.title}`} stages={shown.map((s) => ({ code: s.code, label: s.label }))} value={deal.stage} onMove={onMove} readOnly={readOnly} className="mb-3" />
      <KeyValue
        items={[
          ["Number", deal.number],
          [
            "Stage",
            deal.meaning ? (
              <HelpTerm key="s" help={`Counts as ${MEANING_LABEL[deal.meaning]} in totals and reports.`}>
                {deal.stage_label}
              </HelpTerm>
            ) : (
              deal.stage_label
            ),
          ],
          ["Health", <StatusPill key="h" status={healthPill(deal.health)} />],
          ...(deal.blockers ? ([["Blockers", deal.blockers]] as Array<[ReactNode, ReactNode]>) : []),
          ["Next Action", deal.next_action ? `${deal.next_action}${deal.next_action_on ? `, ${formatDate(deal.next_action_on)}` : ""}` : "None"],
          ["Expected Close", deal.expected_close_on ? formatDate(deal.expected_close_on) : "None"],
          ["Projected Value", deal.estimated_value ? formatMoney(deal.estimated_value) : "None"],
          ...(deal.event_starts_on ? ([["Event", `${formatDate(deal.event_starts_on)}${deal.event_ends_on ? ` to ${formatDate(deal.event_ends_on)}` : ""}`]] as Array<[ReactNode, ReactNode]>) : []),
          ...(money && deal.commission_pct ? ([["Commission", `${deal.commission_pct}%`]] as Array<[ReactNode, ReactNode]>) : []),
        ]}
      />
      {deal.options.length > 0 && (
        <DataView
          title="Options"
          rows={deal.options}
          rowKey={(o) => o.deal_option_id}
          columns={[
            { key: "l", label: "Option", render: (o) => o.label },
            { key: "p", label: "Deal Price", align: "n", render: (o) => (o.deal_price ? formatMoney(o.deal_price) : (o.price_note ?? "None")) },
            ...(money ? [{ key: "c", label: "Commission", align: "n" as const, render: (o: (typeof deal.options)[number]) => (o.commission_amount ? formatMoney(o.commission_amount) : "None"), desktop: true }] : []),
          ]}
        />
      )}
    </Card>
  );
}

/** Stage and health lines, newest first; a record's lines each name their deal. */
export function HistoryCard({ lines }: { lines: Array<StageHistoryLine | RecordHistoryLine> }) {
  if (!lines.length) return null;
  return (
    <Card>
      <CardHeader title="Stage History" />
      <Timeline
        items={lines.map((h) => ({
          title: `${"deal_title" in h ? `${h.deal_title} · ` : ""}${h.kind === "stage" ? `Moved to ${h.to_label}` : `Health: ${h.to_label}`}`,
          when: formatDateTime(h.changed_at),
          text: [h.by?.display_name, h.reason].filter(Boolean).join(". ") || undefined,
        }))}
      />
    </Card>
  );
}

/** The latest interactions, as the Overview lists them. */
export function InteractionsCard({ items, title = "Latest Interactions" }: { items: Interaction[]; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {items.length ? (
        <Timeline items={items.map((i) => ({ title: i.subject, when: formatDateTime(i.occurred_at), text: [i.owner?.display_name, i.summary].filter(Boolean).join(". ") || undefined }))} />
      ) : (
        <EmptyState bare title="No Interactions Yet" text="Log a call, meeting or note." />
      )}
    </Card>
  );
}

const KIND: Record<Interaction["interaction_type"], string> = { call: "Call", meeting: "Meeting", email: "Email", visit: "Visit", note: "Note" };

/**
 * One interaction whole: what was said and by whom. A message from a linked conversation shows who it
 * was from and to and its first lines (§6.15); only the mailbox's owner may open the conversation.
 */
function InteractionDetail({ i }: { i: Interaction }) {
  return (
    <>
      <KeyValue
        items={[
          ["When", formatDateTime(i.occurred_at)],
          ["Kind", KIND[i.interaction_type]],
          ["By", i.owner?.display_name ?? null],
          ...(i.mail ? ([["From", i.mail.from], ["To", i.mail.to.join(", ") || null]] as Array<[string, ReactNode]>) : []),
          ["Contact", i.contact?.name ?? null],
        ]}
      />
      {i.summary && <p data-copy="content" className="mt-3 text-sm whitespace-pre-line">{i.summary}</p>}
      {i.mail?.mail_thread_id && (
        <p className="mt-3">
          <Link className="font-semibold text-primary underline" to={hrefFor("mailbox", "inbox", { id: i.mail.mail_thread_id })}>Open in Mailbox</Link>
        </p>
      )}
    </>
  );
}

/** Activity: every interaction, newest first, and the stage and health history (a lead's deal's; a partner's deals'). */
export function ActivityTab({ record, history }: { record: RecordKey; history?: Array<StageHistoryLine | RecordHistoryLine> }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/partnerships/interactions", { filters: record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id }, sort: "-occurred_at" });
  const open = (i: Interaction) => modal.open({ title: i.subject.slice(0, 80), body: () => <InteractionDetail i={i} /> });
  return (
    <>
      <PagedTable<Interaction>
        title="Interactions"
        list={list}
        rowKey={(i) => i.partner_interaction_id}
        noun="interaction"
        onRowClick={open}
        empty={{ title: "No Interactions Yet", text: "Log a call, meeting or note." }}
        columns={[
          { key: "w", label: "When", render: (i) => formatDateTime(i.occurred_at) },
          { key: "k", label: "Kind", render: (i) => <Pill>{KIND[i.interaction_type]}</Pill> },
          { key: "s", label: "Subject", render: (i) => (i.mail ? <span data-copy="content">{i.subject}<span className="block text-2xs text-subtle-foreground">{i.mail.from}</span></span> : i.subject) },
          { key: "b", label: "By", render: (i) => i.owner?.display_name ?? "None", desktop: true },
        ]}
      />
      {history && history.length > 0 && <div className="mt-3"><HistoryCard lines={history} /></div>}
    </>
  );
}

/** Documents: every file of the record, newest first; Upload Document; a partner signed before the hub says so (§6.6). */
export function DocumentsTab({ record, readOnly, signedOutside }: { record: RecordKey; readOnly?: boolean; signedOutside?: boolean }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/partnerships/documents", { filters: record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id }, sort: "-created_at" });
  const ORIGIN: Record<string, string> = { upload: "Upload", proposal: "Proposal", agreement: "Agreement", signed_copy: "Signed Copy" };
  return (
    <PagedTable
      title="Documents"
      list={list}
      rowKey={(d) => d.document.document_id}
      noun="document"
      right={
        <span className="flex items-center gap-2">
          {signedOutside && <Pill>Signed Before the Hub</Pill>}
          {!readOnly && <Button size="sm" icon="plus" onClick={() => modal.open({ title: "Upload Document", body: (close) => <UploadDocument record={record} close={close} /> })}>Upload Document</Button>}
        </span>
      }
      empty={{ title: "No Documents Yet", text: "Signed copies and uploads show here." }}
      columns={[
        { key: "f", label: "File", render: (d) => d.document.file_name },
        { key: "k", label: "Kind", render: (d) => d.kind_label ?? ORIGIN[d.origin] },
        { key: "b", label: "By", render: (d) => d.uploaded_by ?? "None", desktop: true },
        { key: "d", label: "Added", render: (d) => formatDate(d.created_at) },
      ]}
    />
  );
}

/** Contacts: the people at the record; Add Contact, and a row opens Edit Contact. */
export function ContactsTab({ record, contacts, readOnly }: { record: RecordKey; contacts: Contact[]; readOnly?: boolean }) {
  const modal = useModal();
  return (
    <DataView
      title="Contacts"
      rows={contacts}
      rowKey={(c) => c.partner_contact_id}
      onRowClick={readOnly ? undefined : (c) => modal.open({ title: "Edit Contact", body: (close) => <ContactForm record={record} contact={c} close={close} /> })}
      right={readOnly ? undefined : <Button size="sm" icon="plus" onClick={() => modal.open({ title: "Add Contact", body: (close) => <ContactForm record={record} close={close} /> })}>Add Contact</Button>}
      empty={{ title: "No Contacts Yet", text: "Add the people you deal with." }}
      columns={[
        { key: "n", label: "Name", render: (c) => `${c.first_name} ${c.last_name}` },
        { key: "j", label: "Position", render: (c) => c.job_title ?? "None", desktop: true },
        { key: "e", label: "Email", render: (c) => c.email ?? "None", desktop: true },
        { key: "p", label: "Phone", render: (c) => c.phones[0] ?? "None" },
        { key: "r", label: "Role", render: (c) => (c.primary_contact ? <Pill tone="ok">Primary</Pill> : c.signatory ? <Pill>Signs</Pill> : null) },
      ]}
    />
  );
}

/** A custom field's value as a person reads it. */
const shownValue = (v: unknown) => (v === null || v === undefined || v === "" ? "None" : typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v));

/** Details: the organisation's own fields; custom fields behind the Details row. */
export function DetailsTab({ items, fields, custom }: { items: Array<[ReactNode, ReactNode]>; fields: CustomField[]; custom: CustomValues }) {
  const filled = fields.filter((f) => custom[f.key] !== undefined);
  return (
    <Card>
      <CardHeader title="Organisation" />
      <KeyValue items={items} />
      {filled.length > 0 && <Details title="Custom Fields" items={filled.map((f) => [f.active ? f.label : `${f.label} (Retired)`, shownValue(custom[f.key])] as [ReactNode, ReactNode])} />}
    </Card>
  );
}

/** Days Since Last Contact's help (§10.1). */
export const SINCE_CONTACT_HELP = "Whole days since the latest call, meeting, email, visit or note; since it was added when there is none.";

/** A 360 still loading or refused. */
export function RecordState({ loading, error, onRetry }: { loading: boolean; error: unknown; onRetry: () => void }) {
  if (error) return <EmptyState title="Not Available" text="It may have moved or closed." action={<Button onClick={onRetry}>Try Again</Button>} />;
  return loading ? <LoadingRows count={8} /> : null;
}

/** A deal's whole record, for a partner's Overview (its list row carries no history). */
export function useDeal(id: string | null) {
  return useApi("GET /api/v1/partnerships/deals/:id", { params: { id: id ?? "" }, enabled: Boolean(id) });
}
