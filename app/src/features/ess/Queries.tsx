import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import queries from "@mycity/contract/schemas/queries.js";
import type { MyQuery, MySanction } from "@mycity/contract/contract.gen.ts";
import { LetterFile } from "@/features/shared/Letter";
import { ActionGroup, Button, Card, CardHeader, cn, DataView, EmptyState, Field, formatDate, formatDateTime, FormFooter, Grid, Icon, KeyValue, Money, PageHeader, Pager, Pill, TextAreaField, toast, useContractForm, useModal, type IconName } from "@mycity/ui";

type View = "open" | "archived" | "sanctions";

export function MyQueriesPage() {
  const s = useApi("GET /api/v1/ess/queries/summary");
  const [view, setView] = useState<View>("open");
  const card = (k: View, icon: IconName, label: string, n: number, sub: string, tone?: "ok" | "warn") => (
    <button
      type="button"
      onClick={() => setView(k)}
      aria-pressed={view === k}
      className={cn("flex w-full min-w-0 flex-col gap-1.5 rounded-card border bg-card p-3.5 text-left shadow-1 hover:border-subtle-foreground", view === k ? "border-secondary ring-1 ring-secondary" : "border-border")}
    >
      <span className={cn("flex size-8.5 items-center justify-center rounded-box", tone === "ok" ? "bg-success-soft text-success" : tone === "warn" ? "bg-warning-soft text-warning" : "bg-accent text-accent-foreground")}>
        <Icon name={icon} size="m" />
      </span>
      <span className="mt-1 text-2xs font-semibold text-muted-foreground">{label}</span>
      <b className="text-3xl leading-none font-bold tracking-tight">{n}</b>
      <span className="text-2xs text-subtle-foreground">{sub}</span>
    </button>
  );
  return (
    <>
      <PageHeader title="My Queries" sub="Queries raised against you, and their outcome" />
      {s.data && (
        <Grid cols={3}>
          {card("open", "alert", "Open Queries", s.data.open, s.data.open ? "Waiting on your response" : "Nothing waiting on you", s.data.open ? "warn" : "ok")}
          {card("archived", "doc", "Archived", s.data.archived, s.data.archived ? "Closed" : "None yet")}
          {card("sanctions", "flag", "Sanctions", s.data.sanctions, s.data.last_sanction ? `Last on ${formatDate(s.data.last_sanction)}` : "None", s.data.sanctions ? "warn" : undefined)}
        </Grid>
      )}
      {view === "open" && <OpenQueries />}
      {view === "archived" && <Archived />}
      {view === "sanctions" && <Sanctions />}
    </>
  );
}

function OpenQueries() {
  const list = usePaged("GET /api/v1/ess/queries", { filters: { status: "open" } });
  const modal = useModal();
  if (!list.loading && !list.rows.length) return <EmptyState icon="ok" title="No Open Queries" text="Nothing raised. You get 48 hours to respond." />;
  return (
    <>
      {list.rows.map((q) => (
        <Card key={q.employee_query_id} className="mb-3">
          <CardHeader record title={`${q.number} · ${q.subject}`} right={<Pill tone={q.can_respond ? "warn" : "info"}>{q.can_respond ? "Awaiting Your Response" : "Under Review"}</Pill>} />
          <KeyValue items={[["Raised On", formatDate(q.created_at)], ["Respond By", q.response_due_at ? formatDateTime(q.response_due_at) : "None"], ["Your Response", q.response?.body ?? "Not yet"]]} />
          <ActionGroup>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button icon="doc" onClick={() => modal.open({ title: `${q.number} · Letter`, wide: true, body: <LetterFile documentId={q.letter_document_id} name={q.number} /> })}>View Letter</Button>
              {q.can_respond && <Button variant="primary" icon="send" onClick={() => modal.open({ title: `Respond to ${q.number}`, body: (close) => <Respond q={q} close={close} /> })}>Respond</Button>}
            </div>
          </ActionGroup>
        </Card>
      ))}
    </>
  );
}

function Respond({ q, close }: { q: MyQuery; close: () => void }) {
  const f = useContractForm({ body: "" }, queries.QueryResponseCreate);
  const send = useMutation("POST /api/v1/ess/queries/:id/response");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await send.run({ params: { id: q.employee_query_id }, body: { body: f.values.body.trim() } });
      invalidate("/api/v1/ess/queries");
      close();
      toast("Response sent");
    } catch {
      f.setServerErrors(send.fields);
    }
  };
  return (
    <>
      <Field label="Your Response" {...f.status("body")}>
        <TextAreaField {...f.field("body")} rows={6} placeholder="Traffic on Ikorodu" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={send.pending} onClick={submit}>Send Response</Button>
      </FormFooter>
    </>
  );
}

const OUTCOME = { no_action: { tone: "ok", text: "Closed, No Action" }, sanctioned: { tone: "neutral", text: "Sanctioned" } } as const;

function Archived() {
  const list = usePaged("GET /api/v1/ess/queries", { filters: { status: "archived" } });
  return (
    <DataView
      title="Archived Queries"
      rows={list.rows}
      rowKey={(r: MyQuery) => r.employee_query_id}
      loading={list.loading}
      empty={{ title: "Nothing Archived" }}
      columns={[
        { key: "n", label: "Number", desktop: true, render: (r: MyQuery) => r.number },
        { key: "s", label: "Subject", render: (r: MyQuery) => r.subject },
        { key: "d", label: "Date", render: (r: MyQuery) => formatDate(r.created_at) },
        { key: "y", label: "Your Response", desktop: true, render: (r: MyQuery) => r.response?.body ?? "None" },
        { key: "o", label: "Outcome", render: (r: MyQuery) => (r.outcome ? <Pill tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].text}</Pill> : null) },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="query" nounPlural="queries" />}
    />
  );
}

function Sanctions() {
  const modal = useModal();
  const list = usePaged("GET /api/v1/ess/sanctions");
  return (
    <DataView
      title="Sanctions"
      rows={list.rows}
      rowKey={(r: MySanction) => r.sanction_id}
      loading={list.loading}
      onRowClick={(r: MySanction) => modal.open({ title: `${r.number} · Letter`, wide: true, body: <LetterFile documentId={r.letter_document_id} name={r.number} /> })}
      empty={{ title: "No Sanctions", text: "A clean record." }}
      columns={[
        { key: "k", label: "Sanction", render: (r: MySanction) => r.step_name },
        { key: "q", label: "Query", desktop: true, render: (r: MySanction) => r.query_number },
        { key: "r", label: "Reason", render: (r: MySanction) => r.reason },
        { key: "d", label: "Date", render: (r: MySanction) => formatDate(r.effective_on) },
        { key: "m", label: "Fine", align: "n", render: (r: MySanction) => (r.fine ? <Money value={r.fine.amount_ngn} /> : "None") },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="sanction" />}
    />
  );
}
