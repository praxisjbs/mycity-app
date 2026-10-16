import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import "@/api/types/knowledge";
import type { AiAnswer, AiTurn } from "@/api/types/knowledge";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ExportAction, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AreaChart, Button, Card, CardHeader, cn, Form, formatDateTime, formatMoneyShort, FormFooter, Grid, Icon, InlineInput, LoadingRows, Money, PageHeader, toast, useModal } from "@mycity/ui";

export default function Assistant({ tab }: ModuleScreenProps) {
  return tab === "history" ? <History /> : <Ask />;
}

type Turn = { q: string; a: AiAnswer | null; error?: string };

function Answer({ a }: { a: AiAnswer }) {
  const { navigate } = useRouter();
  return (
    <div className="max-w-[92%] rounded-[12px_12px_12px_4px] border border-border bg-card p-[13px]">
      <p className="text-[13.5px]">{a.text}</p>
      {a.table && (
        <div className="mt-[11px] overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>{a.table.columns.map((c, i) => <th key={c} className={cn("border-b border-border bg-muted px-3 py-2 text-left text-[10.5px] font-[650] tracking-[.09em] text-subtle-foreground uppercase", a.table!.numeric.includes(i) && "text-right")}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {a.table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={cn("border-b border-border px-3 py-2 last:[tr:last-child_&]:border-b-0", a.table!.numeric.includes(j) && "text-right")}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.note && <p className="mt-[11px] text-[13px] text-muted-foreground">{a.note}</p>}
      {a.action && (
        <div className="mt-[11px] flex flex-wrap gap-2">
          <Button variant="primary" iconRight="right" onClick={() => navigate(a.action!.link)}>{a.action.label}</Button>
        </div>
      )}
      {a.sources.length > 0 && (
        <div className="mt-[11px] flex flex-wrap gap-1.5 border-t border-dashed border-border pt-2.5">
          <b className="self-center text-[10.5px] tracking-[.08em] text-subtle-foreground uppercase">From</b>
          {a.sources.map((s) => <span key={s.label} className="rounded-full border border-border bg-muted px-[9px] py-[3px] text-[11px] text-muted-foreground">{s.label} ×{s.count}</span>)}
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
      const a = await api.call("POST /api/v1/ai/ask", { body: { question } });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
      invalidate("/api/v1/ai/history");
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof ApiError ? e.message : "Could not reach the assistant" } : x)));
    }
    setBusy(false);
  };
  return (
    <>
      <PageHeader title="Praxis AI" sub="Answers from your data, within your permissions" />
      <Card className="max-w-[840px]">
        <div className="flex flex-col gap-3.5">
          
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-3.5">
              <div className="ml-auto w-fit max-w-[78%] rounded-[12px_12px_4px_12px] border border-border bg-accent px-[13px] py-2.5 text-[13.5px]">{t.q}</div>
              {t.a ? <Answer a={t.a} /> : t.error ? <p className="text-[12.5px] text-destructive">{t.error}</p> : (
                <div className="flex w-fit items-center gap-2 rounded-[12px_12px_12px_4px] border border-border px-[13px] py-2.5 text-[12.5px] text-subtle-foreground"><Icon name="spark" className="animate-pulse" />Reading the records you can see</div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
        <Form className="mt-4 flex gap-2" onSubmit={() => void ask(text)}>
          <InlineInput className="h-[42px] max-md:h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-[13.5px] outline-none focus:border-ring" placeholder="Ask a question" aria-label="Ask Praxis AI" value={text} onChange={setText} />
          <button type="submit" disabled={busy || text.trim().length < 4} aria-label="Ask" className="on-primary flex size-[42px] max-md:size-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Icon name="send" /></button>
        </Form>
      </Card>
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="Try Asking" />
          <div data-copy="content">
          {(sug.data ?? []).map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => void ask(q)} className="mb-1.5 block w-full rounded-box border border-border bg-card px-3 py-2.5 text-left max-md:min-h-11 text-[12.5px] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-2">
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
  const list = usePaged("GET /api/v1/ai/history");
  return (
    <>
      <PageHeader
        title="History"
        sub="Your questions, and what they read"
        actions={
          <>
            <ExportAction source="ai.history" />
            <Button onClick={() => modal.open({ title: "Clear History", body: (close) => <ClearHistory close={close} /> })}>Clear History</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Questions This Month", value: String(s.data.questions_this_month) }, { label: "Your Questions", value: String(s.data.yours) }, { label: "Spend", value: <Money value={s.data.spend} /> }, { label: "Monthly Cap", value: formatMoneyShort(s.data.cap), tone: "ok" }]} />}
      <PagedTable<AiTurn>
        title="Your Questions"
        list={list}
        search="Search your questions"
        rowKey={(t) => t.turn_id}
        noun="question"
        empty={{ title: "No Questions Yet", text: "What you ask Praxis AI is listed here with what it read." }}
        columns={[
          { key: "q", label: "Question", render: (t) => t.question },
          { key: "a", label: "Asked", render: (t) => formatDateTime(t.asked_at) },
          { key: "s", label: "Sources Read", render: (t) => t.sources, desktop: true },
          { key: "k", label: "Tokens", align: "n", render: (t) => t.tokens.toLocaleString("en-NG"), desktop: true },
          { key: "c", label: "Cost", align: "n", render: (t) => <Money value={t.cost} /> },
        ]}
      />
      {s.data && (
        <Grid cols={2} className="mt-3">
          <AreaChart title="Spend per Month, Naira" values={s.data.trend.values.map(Number)} labels={s.data.trend.labels} caption={`Against a ${formatMoneyShort(s.data.cap)} monthly cap.`} />
          <BarsCard title="Questions by Topic" rows={s.data.topics} />
        </Grid>
      )}
    </>
  );
}

function ClearHistory({ close }: { close: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-[13px] text-muted-foreground">Your questions and their answers are removed from this list. The spend record stays, for the monthly cap.</p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); await api.call("DELETE /api/v1/ai/history"); invalidate("/api/v1/ai"); close(); toast("History cleared"); }}>Clear</Button>
      </FormFooter>
    </>
  );
}
