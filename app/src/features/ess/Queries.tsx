import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import queries from "@mycity/contract/schemas/queries.js";
import type { MyQuery, MySanction } from "@mycity/contract/contract.gen.ts";
import { LetterFile } from "@/features/shared/Letter";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  DataView,
  Field,
  formatDate,
  formatDateTime,
  FormFooter,
  HelpTerm,
  KeyValue,
  ListDetail,
  Money,
  PageHeader,
  Pill,
  RichText,
  RichTextField,
  SegmentedControl,
  toast,
  useContractForm,
  useModal,
  useSideBySide,
} from "@mycity/ui";

/**
 * ESS · My Queries (docs/guides/queries.md §10, ess.md §10): one tab with a Queries and Sanctions
 * switch. Queries lists every query raised against the person, open ones first, and the picked one
 * opens beside the list (a sheet on a phone); Sanctions is read only, each opening its letter.
 */
type View = "queries" | "sanctions";

export function MyQueriesPage() {
  const s = useApi("GET /api/v1/ess/queries/summary");
  const [view, setView] = useState<View>("queries");
  return (
    <>
      <PageHeader title="My Queries" />
      <SegmentedControl<View>
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: "queries", label: "Queries", count: s.data?.open },
          { value: "sanctions", label: "Sanctions", count: s.data?.sanctions },
        ]}
        className="mb-3"
      />
      {view === "queries" ? <QueryList /> : <SanctionList />}
    </>
  );
}

const OUTCOME = { no_action: { tone: "ok", text: "Closed, No Action" }, sanctioned: { tone: "neutral", text: "Sanctioned" } } as const;

function status(q: MyQuery) {
  if (q.status === "resolved" && q.outcome) return OUTCOME[q.outcome];
  return q.can_respond ? ({ tone: "warn", text: "Awaiting Your Response" } as const) : ({ tone: "info", text: "Under Review" } as const);
}

function QueryList() {
  const list = usePaged("GET /api/v1/ess/queries");
  const beside = useSideBySide();
  const [sel, setSel] = useState<string | null>(null);
  // Beside the list the newest open query shows unasked; on a phone nothing opens until a row is tapped (F31).
  const shown = list.rows.find((q) => q.employee_query_id === sel) ?? (beside ? (list.rows[0] ?? null) : null);
  return (
    <ListDetail
      open={sel !== null}
      onClose={() => setSel(null)}
      title="Query"
      list={
        <DataView
          title="Queries"
          list={list}
          rowKey={(q: MyQuery) => q.employee_query_id}
          noun="query"
          nounPlural="queries"
          onRowClick={(q: MyQuery) => setSel(q.employee_query_id)}
          empty={{ title: "No Queries", text: "Nothing has been raised." }}
          columns={[
            { key: "n", label: "Number", desktop: true, render: (q: MyQuery) => q.number },
            { key: "s", label: "Subject", render: (q: MyQuery) => q.subject },
            { key: "d", label: "Raised", render: (q: MyQuery) => formatDate(q.created_at) },
            { key: "o", label: "Status", render: (q: MyQuery) => <Pill tone={status(q).tone}>{status(q).text}</Pill> },
          ]}
        />
      }
      detail={shown ? <QueryRecord q={shown} /> : null}
    />
  );
}

function QueryRecord({ q }: { q: MyQuery }) {
  const modal = useModal();
  const s = status(q);
  return (
    <Card>
      <CardHeader record title={`${q.number} · ${q.subject}`} right={<Pill tone={s.tone}>{s.text}</Pill>} />
      <KeyValue
        items={[
          ["Raised On", formatDate(q.created_at)],
          [<HelpTerm key="due" help="You have 48 hours from when it was raised.">Respond By</HelpTerm>, q.response_due_at ? formatDateTime(q.response_due_at) : "None"],
          ["What Happened", <span key="d" data-copy="content">{q.details}</span>],
          ["Your Response", q.response ? <RichText key="r" blocks={q.response.blocks} top={4} /> : "Not yet"],
          ...(q.sanction ? ([["Sanction", q.sanction.step_name]] as Array<[string, string]>) : []),
        ]}
      />
      <ActionGroup>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button icon="doc" onClick={() => modal.open({ title: `${q.number} · Letter`, wide: true, full: true, body: <LetterFile documentId={q.letter_document_id} name={q.number} /> })}>
            View Letter
          </Button>
          {q.can_respond && (
            <Button variant="primary" icon="send" className="max-md:w-full" onClick={() => modal.open({ title: `Respond to ${q.number}`, body: (close) => <Respond q={q} close={close} /> })}>
              Respond
            </Button>
          )}
        </div>
      </ActionGroup>
    </Card>
  );
}

function Respond({ q, close }: { q: MyQuery; close: () => void }) {
  const f = useContractForm({ body_html: "" }, queries.QueryResponseCreate);
  const send = useMutation("POST /api/v1/ess/queries/:id/response");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await send.run({ params: { id: q.employee_query_id }, body: { body_html: f.values.body_html } });
      invalidate("/api/v1/ess/queries");
      close();
      toast("Response sent");
    } catch {
      f.setServerErrors(send.fields);
    }
  };
  return (
    <>
      <Field label="Your Response" {...f.status("body_html")}>
        <RichTextField label="Your Response" {...f.field("body_html")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={send.pending} onClick={submit}>
          Send Response
        </Button>
      </FormFooter>
    </>
  );
}

function SanctionList() {
  const modal = useModal();
  const list = usePaged("GET /api/v1/ess/sanctions");
  return (
    <DataView
      title="Sanctions"
      list={list}
      rowKey={(r: MySanction) => r.sanction_id}
      noun="sanction"
      onRowClick={(r: MySanction) => modal.open({ title: `${r.number} · Letter`, wide: true, full: true, body: <LetterFile documentId={r.letter_document_id} name={r.number} /> })}
      empty={{ title: "No Sanctions", text: "A clean record." }}
      columns={[
        { key: "k", label: "Sanction", render: (r: MySanction) => r.step_name },
        { key: "q", label: "Query", desktop: true, render: (r: MySanction) => r.query_number },
        { key: "r", label: "Reason", render: (r: MySanction) => <span data-copy="content">{r.reason}</span> },
        { key: "d", label: "Date", render: (r: MySanction) => formatDate(r.effective_on) },
        { key: "m", label: "Fine", align: "n", render: (r: MySanction) => (r.fine ? <Money value={r.fine.amount_ngn} /> : "None") },
      ]}
    />
  );
}
