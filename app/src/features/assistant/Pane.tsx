import { useCallback, useState } from "react";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import type { AiAnswer } from "@mycity/contract/contract.gen.ts";
import { EmptyState, formatDateTime, OverviewPane, PaneSheet, PaneTabs, paneValue, paneWords, RecordPane, SourcesPane, TablePane, type PaneRead, type PaneRecord, type PaneTab } from "@mycity/ui";

/**
 * The right pane (docs/guides/praxis-ai.md §6.13, decision 13): Overview, Table, Record and Sources
 * for one answer, the latest unless an earlier answer's chip or Open Figures brought its own back.
 * Desktop shows it beside the conversation (AnswerPane in AssistantShell); a phone opens it as a
 * sheet (PhonePane). The Table pages the answer's read again (GET /ai/answers/:id/reads/:n, §6.12),
 * so its rows come from the records with the person's rights now, never from the model. The Table's
 * Export asks for every row of that read as a workbook (POST /ai/answers/:id/reads/:n/export, §6.16),
 * made in the worker and saved on this device like every export (foundation.md §6.12).
 */

/** The answer in the pane, which view, which of its reads the Table pages, and the record picked. */
export interface PaneShown {
  answer: AiAnswer;
  tab: PaneTab;
  readN: number | null;
  record: PaneRecord | null;
}

/** What a chip or a row asks the pane to show. */
export interface PanePick {
  tab?: PaneTab;
  readN?: number;
  record?: PaneRecord;
}

/** The read the Table pages first: the one the answer's table came from, else the first that returned rows. */
const firstReadN = (a: AiAnswer): number | null => a.table?.read ?? a.reads.find((r) => r.kind === "read" && r.outcome === "read" && r.rows > 0)?.n ?? null;

const defaultTab = (a: AiAnswer, readN: number | null): PaneTab => (a.overview ? "overview" : readN ? "table" : "sources");

export function usePane() {
  const [shown, setShown] = useState<PaneShown | null>(null);
  const show = useCallback(
    (answer: AiAnswer, pick: PanePick = {}) =>
      setShown((s) => {
        const same = s && s.answer.ai_message_id === answer.ai_message_id ? s : null;
        const readN = pick.readN ?? (same ? same.readN : firstReadN(answer));
        const record = pick.record ?? (same ? same.record : null);
        const tab = pick.tab ?? (same ? same.tab : defaultTab(answer, readN));
        return { answer, tab, readN, record };
      }),
    [],
  );
  const setTab = useCallback((tab: PaneTab) => setShown((s) => (s ? { ...s, tab } : s)), []);
  const openRecord = useCallback((record: PaneRecord) => setShown((s) => (s ? { ...s, record, tab: "record" } : s)), []);
  const openTable = useCallback((n: number) => setShown((s) => (s ? { ...s, readN: n, tab: "table" } : s)), []);
  const clear = useCallback(() => setShown(null), []);
  return { shown, show, setTab, openRecord, openTable, clear };
}

export type Pane = ReturnType<typeof usePane>;

/** What a source chip asks for: the Table of the read that cited that kind of record, else the Sources. */
export function pickForSource(a: AiAnswer, entityType: string): PanePick {
  const readKey = a.citations.find((c) => c.entity_type === entityType)?.read_key;
  const n = readKey ? a.reads.find((r) => r.key === readKey && r.kind === "read" && r.outcome === "read" && r.rows > 0)?.n : undefined;
  return n ? { tab: "table", readN: n } : { tab: "sources" };
}

/** The answer's reads as the Sources tab lists them: named in words, their parameters as label and value. */
export function paneReadsOf(a: AiAnswer): PaneRead[] {
  return a.reads.map((r) => ({
    n: r.n,
    name: paneWords(r.key),
    kind: r.kind,
    outcome: r.outcome,
    filters: Object.entries(r.params)
      .filter(([k]) => k !== "page")
      .map(([k, v]) => [paneWords(k), paneValue(v)] as const)
      .filter(([, v]) => v !== ""),
    rows: r.rows,
    total: r.total,
    masked: (r.masked ?? []).map(paneWords),
    opens: r.kind === "read" && r.outcome === "read" && r.rows > 0,
  }));
}

/** One read of the answer, run again and paged at 25 (§6.12), as the Table shows it; Export saves every row (§6.16). */
function ReplayTable({ id, n, onOpenRow }: { id: string; n: number; onOpenRow: (record: PaneRecord) => void }) {
  const [page, setPage] = useState(1);
  const res = useApi("GET /api/v1/ai/answers/:id/reads/:n", { params: { id, n }, query: { page } });
  const d = res.data;
  const exportRows = () => saveExport(api.call("POST /api/v1/ai/answers/:id/reads/:n/export", { params: { id, n }, body: {} }));
  const recordOf = (i: number): PaneRecord => ({
    title: d?.rows[i]?.[0] || "Record",
    items: (d?.columns ?? []).map((c, j) => [c, d?.rows[i]?.[j] ?? ""] as const),
    link: d?.links[i] ?? null,
  });
  return (
    <TablePane
      caption={d ? paneWords(d.key) : "Rows"}
      columns={d?.columns ?? []}
      rows={d?.rows ?? []}
      numeric={d?.numeric ?? []}
      links={d?.links ?? []}
      page={d?.page}
      loading={res.loading}
      error={res.error}
      onPage={setPage}
      onReload={res.reload}
      onOpenRow={(i) => onOpenRow(recordOf(i))}
      onExport={d ? exportRows : undefined}
    />
  );
}

/** The pane's views for the answer shown, or the empty pane before any answer. */
export function AnswerPane({ pane }: { pane: Pane }) {
  const { navigate } = useRouter();
  const s = pane.shown;
  if (!s) return <EmptyState bare title="No Answer Yet" text="Ask a question to fill this pane." className="m-auto" />;
  const a = s.answer;
  return (
    <PaneTabs
      value={s.tab}
      onValueChange={pane.setTab}
      overview={a.overview ? <OverviewPane overview={a.overview} /> : undefined}
      table={s.readN ? <ReplayTable key={`${a.ai_message_id}:${s.readN}`} id={a.ai_message_id} n={s.readN} onOpenRow={pane.openRecord} /> : undefined}
      record={s.record ? <RecordPane record={s.record} onOpen={navigate} /> : undefined}
      sources={a.reads.length ? <SourcesPane reads={paneReadsOf(a)} when={formatDateTime(a.created_at)} onOpenTable={pane.openTable} /> : undefined}
    />
  );
}

/** On a phone: the pane as a sheet over the conversation, open while an answer is shown in it. */
export function PhonePane({ pane }: { pane: Pane }) {
  return (
    <PaneSheet open={pane.shown !== null} onClose={pane.clear}>
      <AnswerPane pane={pane} />
    </PaneSheet>
  );
}
