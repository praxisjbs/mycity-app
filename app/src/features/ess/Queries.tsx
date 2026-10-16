import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { MyQuery } from "@/api/types/ess";
import { Button, Card, CardHeader, cn, DataView, EmptyState, Field, formatDate, formatDateTime, FormFooter, Grid, Icon, KeyValue, Money, PageHeader, Pager, Pill, rules, TextAreaField, toast, useContractForm, useModal, type IconName } from "@mycity/ui";

type View = "open" | "archived" | "sanctions";

export function MyQueriesPage() {
  const s = useApi("GET /api/v1/ess/queries/summary");
  const [view, setView] = useState<View>("open");
  const card = (k: View, icon: IconName, label: string, n: number, sub: string, tone?: "ok" | "warn") => (
    <button
      type="button"
      onClick={() => setView(k)}
      aria-pressed={view === k}
      className={cn("flex w-full min-w-0 flex-col gap-1.5 rounded-card border bg-card p-[14px] text-left shadow-1 hover:border-subtle-foreground", view === k ? "border-secondary shadow-[0_0_0_1px_var(--secondary)]" : "border-border")}
    >
      <span className={cn("flex size-[34px] items-center justify-center rounded-box", tone === "ok" ? "bg-success-soft text-success" : tone === "warn" ? "bg-warning-soft text-warning" : "bg-accent text-accent-foreground")}>
        <Icon name={icon} size="m" />
      </span>
      <span className="mt-1 text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <b className="text-[25px] leading-[1.05] font-bold tracking-[-.028em]">{n}</b>
      <span className="text-[11.5px] text-subtle-foreground">{sub}</span>
    </button>
  );
  return (
    <>
      <PageHeader title="My Queries" sub="Queries raised against you, and their outcome" />
      {s.data && (
        <Grid cols={3}>
          {card("open", "alert", "Open Queries", s.data.open, s.data.open ? "Waiting on your response" : "Nothing waiting on you", s.data.open ? "warn" : "ok")}
          {card("archived", "doc", "Archived", s.data.archived, s.data.archived_note)}
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
  const list = usePaged("GET /api/v1/ess/queries", { filters: { view: "open" } });
  const modal = useModal();
  if (!list.loading && !list.rows.length) return <EmptyState icon="ok" title="No Open Queries" text="Nothing raised. You get 48 hours to respond." />;
  return (
    <>
      {list.rows.map((q) => (
        <Card key={q.query_id} className="mb-3">
          <CardHeader record title={`${q.number} · ${q.subject}`} right={<Pill tone={q.outcome.tone}>{q.outcome.text}</Pill>} />
          <KeyValue items={[["Raised by", q.raised_by], ["Raised on", formatDate(q.date)], ["Respond by", q.respond_by ? formatDateTime(q.respond_by) : "None"], ["Your response", q.response ?? "Not yet"]]} />
          {!q.response && (
            <div className="mt-3 flex justify-end">
              <Button variant="primary" icon="send" onClick={() => modal.open({ title: `Respond to ${q.number}`, body: (close) => <Respond q={q} close={close} /> })}>Respond</Button>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}

function Respond({ q, close }: { q: MyQuery; close: () => void }) {
  const f = useContractForm({ text: "" }, { text: rules.min(20, "At least 20 characters") });
  const send = useMutation("POST /api/v1/ess/queries/:id/response");
  const t = f.field("text");
  return (
    <>
      <Field label="Your Response" {...t} state={send.fields.response ? "bad" : t.state} message={send.fields.response?.[0] ?? t.message}>
        <TextAreaField {...t} rows={6} placeholder="Traffic on Ikorodu" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={send.pending} onClick={async () => f.check() && (await send.run({ params: { id: q.query_id }, body: { response: f.values.text } }), invalidate("/api/v1/ess/queries"), close(), toast("Response sent"))}>
          Send Response
        </Button>
      </FormFooter>
    </>
  );
}

function Archived() {
  const list = usePaged("GET /api/v1/ess/queries", { filters: { view: "archived" } });
  return (
    <DataView
      title="Archived Queries"
      rows={list.rows}
      rowKey={(r) => r.query_id}
      loading={list.loading}
      empty={{ title: "Nothing Archived" }}
      columns={[
        { key: "s", label: "Subject", render: (r) => r.subject },
        { key: "r", label: "Raised By", render: (r) => r.raised_by },
        { key: "d", label: "Date", render: (r) => formatDate(r.date) },
        { key: "y", label: "Your Response", desktop: true, render: (r) => r.response },
        { key: "o", label: "Outcome", render: (r) => <Pill tone={r.outcome.tone}>{r.outcome.text}</Pill> },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="query" nounPlural="queries" />}
    />
  );
}

function Sanctions() {
  const list = usePaged("GET /api/v1/ess/sanctions");
  return (
    <DataView
      title="Sanctions"
      rows={list.rows}
      rowKey={(r) => r.sanction_id}
      loading={list.loading}
      empty={{ title: "No Sanctions", text: "A clean record." }}
      columns={[
        { key: "k", label: "Sanction", render: (r) => r.kind },
        { key: "r", label: "Reason", render: (r) => r.reason },
        { key: "d", label: "Date", render: (r) => formatDate(r.date) },
        { key: "m", label: "Deduction", align: "n", render: (r) => <Money value={r.deduction} /> },
        { key: "s", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="sanction" />}
    />
  );
}
