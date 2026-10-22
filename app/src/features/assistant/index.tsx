import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import type { AiAnswer, AiConversation } from "@mycity/contract/contract.gen.ts";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { Button, Card, CardHeader, cn, Form, formatDateTime, FormFooter, Grid, Icon, InlineInput, LoadingRows, PageHeader, toast, useModal } from "@mycity/ui";

export default function Assistant({ tab }: ModuleScreenProps) {
  return tab === "history" ? <History /> : <Ask />;
}

type Turn = { q: string; a: AiAnswer | null; error?: string };

function Answer({ a }: { a: AiAnswer }) {
  const { navigate } = useRouter();
  return (
    <div className="max-w-11/12 bubble-them border border-border bg-card p-3">
      <p className="text-sm">{a.content}</p>
      {a.table && (
        <div className="mt-2.5 overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{a.table.columns.map((c, i) => <th key={c} className={cn("border-b border-border bg-muted px-3 py-2 text-left text-2xs font-strong tracking-caps text-subtle-foreground uppercase", a.table!.numeric.includes(i) && "text-right")}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {a.table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={cn("border-b border-border px-3 py-2 last:[tr:last-child_&]:border-b-0", a.table!.numeric.includes(j) && "text-right")}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.link && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button variant="primary" iconRight="right" onClick={() => navigate(a.link!.path)}>{a.link.label}</Button>
        </div>
      )}
      {a.citations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-2.5">
          <b className="self-center text-2xs tracking-caps text-subtle-foreground uppercase">From</b>
          {a.citations.map((c) => <span key={`${c.entity_type}:${c.entity_id}`} className="rounded-full border border-border bg-muted px-2 py-0.5 text-2xs text-muted-foreground">{c.label}</span>)}
        </div>
      )}
    </div>
  );
}

function Ask() {
  const sug = useApi("GET /api/v1/ai/suggestions");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns]);
  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 4 || busy) return;
    setText("");
    setBusy(true);
    setTurns((t) => [...t, { q: question, a: null }]);
    try {
      const a = await api.call("POST /api/v1/ai/ask", { body: conversation ? { question, ai_conversation_id: conversation } : { question } });
      setConversation(a.ai_conversation_id);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
      invalidate("/api/v1/ai/conversations");
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof ApiError ? e.message : "Could not reach the assistant" } : x)));
    }
    setBusy(false);
  };
  return (
    <>
      <PageHeader title="Praxis AI" sub="Answers from your data, within your permissions" />
      <Card className="max-w-208">
        <div className="flex flex-col gap-3.5">
          
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-3.5">
              <div className="ml-auto w-fit max-w-4/5 bubble-me border border-border bg-accent px-3 py-2.5 text-sm">{t.q}</div>
              {t.a ? <Answer a={t.a} /> : t.error ? <p className="text-xs text-destructive">{t.error}</p> : (
                <div className="flex w-fit items-center gap-2 bubble-them border border-border px-3 py-2.5 text-xs text-subtle-foreground"><Icon name="spark" className="animate-pulse" />Reading the records you can see</div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
        <Form className="mt-4 flex gap-2" onSubmit={() => ask(text)}>
          <InlineInput className="h-10.5 max-md:h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-sm outline-none focus:border-ring" placeholder="Ask a question" aria-label="Ask Praxis AI" value={text} onChange={setText} />
          <button type="submit" disabled={busy || text.trim().length < 4} aria-label="Ask" className="on-primary flex size-10.5 max-md:size-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Icon name="send" /></button>
        </Form>
      </Card>
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="Try Asking" />
          <div data-copy="content">
          {(sug.data?.questions ?? []).map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => void ask(q)} className="mb-1.5 block w-full rounded-box border border-border bg-card px-3 py-2.5 text-left max-md:min-h-11 text-xs transition hover:-translate-y-px hover:shadow-2">
              {q}
            </button>
          ))}
          </div>
          {!sug.data && <LoadingRows />}
        </Card>
      </Grid>
    </>
  );
}

function History() {
  const modal = useModal();
  const s = useApi("GET /api/v1/ai/history/summary");
  const list = usePaged("GET /api/v1/ai/conversations");
  return (
    <>
      <PageHeader
        title="History"
        sub="Your questions, and what they read"
        actions={
          <>
            <Button onClick={() => modal.open({ title: "Clear History", body: (close) => <ClearHistory close={close} /> })}>Clear History</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Questions This Month", value: String(s.data.questions_this_month) }, { label: "Conversations", value: String(s.data.conversations) }, { label: "Records Read", value: String(s.data.rows_read_this_month) }]} />}
      <PagedTable<AiConversation>
        title="Conversations"
        list={list}
        search="Search conversations"
        rowKey={(c) => c.ai_conversation_id}
        noun="conversation"
        empty={{ title: "No Questions Yet", text: "What you ask Praxis AI is listed here." }}
        columns={[
          { key: "t", label: "Title", render: (c) => c.title ?? "" },
          { key: "a", label: "Last Asked", render: (c) => (c.last_asked_at ? formatDateTime(c.last_asked_at) : "") },
          { key: "q", label: "Questions", align: "n", render: (c) => String(c.questions) },
          { key: "r", label: "Records Read", align: "n", render: (c) => String(c.rows_read), desktop: true },
        ]}
      />
      {s.data && s.data.by_module.length > 0 && (
        <Grid cols={2} className="mt-3">
          <BarsCard title="Questions by Module" rows={s.data.by_module.map((m) => ({ label: m.label, value: String(m.questions), pct: Math.round((m.questions / Math.max(1, s.data!.questions_this_month)) * 100) }))} />
        </Grid>
      )}
    </>
  );
}

function ClearHistory({ close }: { close: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground">Every conversation is removed.</p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); await api.call("DELETE /api/v1/ai/history"); invalidate("/api/v1/ai"); close(); toast("History cleared"); }}>Clear</Button>
      </FormFooter>
    </>
  );
}
