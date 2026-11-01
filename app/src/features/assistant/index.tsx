import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, refresh, useApi, usePaged, type PagedResult } from "@/api/hooks";
import type { AiAnswer, AiConversation, AiQuestion, AiShows } from "@mycity/contract/contract.gen.ts";
import { useRouter, useSearchParams } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import { moduleByKey } from "@/shell/catalogue";
import { useFitPage } from "@/shell/layout-context";
import { useScreenAction } from "@/shell/screen-action";
import type { ModuleScreenProps } from "@/shell/screens";
import { saveExport } from "@/api/exports";
import { BarsCard } from "@/features/shared/sections";
import { Conversation } from "./Conversation";
import { contextOf, fromLabel, useBackTo } from "./context";
import { AnswerPane, PhonePane, usePane } from "./Pane";
import { ChatList, ChatPage } from "./PhoneChat";
import {
  AreaChart,
  AssistantShell,
  Button,
  CardHeader,
  DataView,
  DesktopOnly,
  ExportButton,
  formatCount,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatWhen,
  Grid,
  IconButton,
  KpiCard,
  KpiGrid,
  Menu,
  monthName,
  PageHeader,
  PhoneOnly,
  toast,
  useConfirm,
  useIsMobile,
} from "@mycity/ui";

/** Praxis AI, Ask and History (docs/guides/praxis-ai.md §10). It reads what the person may see; a change is a card the person confirms (PR4). */
export default function Assistant({ tab, id }: ModuleScreenProps) {
  return tab === "history" ? <History /> : <Ask id={id} />;
}

/** The assistant's name, written once in the shell's catalogue (§1.1 decision 5). */
const NAME = moduleByKey("praxis_ai")?.label ?? "Assistant";

/** What the full-screen Praxis AI can draw (AiAsk.shows): an action card inside an answer (§6.11), and the pane. */
const SHOWS: AiShows[] = ["cards", "pane"];

/* ───────────────────────── Ask ───────────────────────── */

/**
 * The full-screen Praxis AI (§1.2 decisions 12 and 13). Opened from a screen, its address carries
 * that screen as `from`: the question's context, and where Back goes. On a phone without one it
 * opens on the person's conversations, as a chat app does.
 */
function Ask({ id }: { id: string | null }) {
  const [params] = useSearchParams();
  const from = params.get("from");
  const phone = useIsMobile();
  if (!phone) return <AskDesktop id={id} from={from} />;
  return from ? <AskPhoneFrom id={id} from={from} /> : <AskPhone id={id} />;
}

/** On desktop: the conversation beside the pane (about two fifths and three fifths), Recent behind a toggle, Back in the header. */
function AskDesktop({ id, from }: { id: string | null; from: string | null }) {
  useFitPage(true);
  const { navigate } = useRouter();
  const [, setParams] = useSearchParams();
  const context = useMemo(() => contextOf(from), [from]);
  const back = useBackTo(from);
  const recent = usePaged("GET /api/v1/ai/conversations");
  const [recentOpen, setRecentOpen] = useState(false);
  const pane = usePane();
  const { show, clear } = pane;
  const open = useCallback(
    (next: string) => {
      clear();
      setParams({ id: next });
    },
    [clear, setParams],
  );
  // A new address rather than a change to this one: ⌘K's New Conversation arrives as ?action=new,
  // which a change made from this render's address would put back. The screen it came from stays.
  const fresh = useCallback(() => navigate(hrefFor("praxis_ai", "ask", from ? { from } : {})), [navigate, from]);
  // A fit page has no floating button: ⌘K's New Conversation (?action=new) runs this.
  useScreenAction({ label: "New Conversation", onSelect: fresh });
  // A new conversation empties the pane with it.
  useEffect(() => {
    if (!id) clear();
  }, [id, clear]);
  const reloadRecent = recent.reload;
  const answered = useCallback(
    (a: AiAnswer) => {
      void reloadRecent();
      void refresh("/api/v1/ai/history");
      show(a);
    },
    [reloadRecent, show],
  );

  return (
    <AssistantShell
      title={NAME}
      back={{ to: fromLabel(from), onBack: back }}
      actions={
        <>
          <Button icon="history" aria-pressed={recentOpen} onClick={() => setRecentOpen((o) => !o)}>
            Recent
          </Button>
          {id && (
            <Button icon="plus" onClick={fresh}>
              New Conversation
            </Button>
          )}
        </>
      }
      aside={<Recent list={recent} current={id} onOpen={open} />}
      asideOpen={recentOpen}
      conversation={
        <Conversation
          id={id}
          context={context}
          shows={SHOWS}
          onOpened={(next) => setParams({ id: next }, { replace: true })}
          onGone={fresh}
          onAnswered={answered}
          onPane={show}
          paneFor={pane.shown?.answer.ai_message_id ?? null}
        />
      }
      pane={<AnswerPane pane={pane} />}
    />
  );
}

/** On a phone, opened from a screen: the conversation full width with Back; an answer's Open Figures opens the pane as a sheet. */
function AskPhoneFrom({ id, from }: { id: string | null; from: string }) {
  useFitPage(true);
  const { navigate } = useRouter();
  const [, setParams] = useSearchParams();
  const context = useMemo(() => contextOf(from), [from]);
  const back = useBackTo(from);
  const pane = usePane();
  const fresh = useCallback(() => navigate(hrefFor("praxis_ai", "ask", { from })), [navigate, from]);
  useScreenAction({ label: "New Conversation", onSelect: fresh });
  const answered = useCallback(() => void refresh("/api/v1/ai/history", "/api/v1/ai/conversations"), []);
  return (
    <>
      <AssistantShell
        title={NAME}
        back={{ to: fromLabel(from), onBack: back }}
        actions={id ? <IconButton icon="plus" label="New Conversation" onClick={fresh} /> : undefined}
        conversation={<Conversation id={id} context={context} shows={SHOWS} onOpened={(next) => setParams({ id: next }, { replace: true })} onGone={fresh} onAnswered={answered} onPane={pane.show} />}
      />
      <PhonePane pane={pane} />
    </>
  );
}

/**
 * On a phone (§10.2), opened from the menu, ⌘K or History: the person's conversations with New
 * Conversation; one, or a new one, opens full screen over them, as the floating button's chat does.
 */
function AskPhone({ id }: { id: string | null }) {
  const [, setParams] = useSearchParams();
  const list = usePaged("GET /api/v1/ai/conversations");
  /* undefined: the list; null: a new conversation; a string: that conversation. */
  const [chat, setChat] = useState<string | null | undefined>(id ?? undefined);
  // History's row (or ⌘K's conversation) asks for one by address: open it, and give the address back to the list.
  useEffect(() => {
    if (!id) return;
    setChat(id);
    setParams({ id: null }, { replace: true });
  }, [id, setParams]);
  const fresh = useCallback(() => setChat(null), []);
  // In the floating button, and ⌘K's New Conversation (?action=new).
  useScreenAction({ label: "New Conversation", onSelect: fresh });
  const reload = list.reload;
  const answered = useCallback(() => {
    void reload();
    void refresh("/api/v1/ai/history");
  }, [reload]);

  return (
    <>
      <PageHeader
        title={NAME}
        actions={
          <Button variant="primary" icon="plus" onClick={fresh}>
            New Conversation
          </Button>
        }
      />
      <ChatList list={list} onOpen={setChat} />
      <ChatPage open={chat !== undefined} id={chat ?? null} onClose={() => setChat(undefined)} onOpen={setChat} onNew={fresh} onAnswered={answered} />
    </>
  );
}

/** Behind the Recent toggle on desktop: the person's conversations, newest first. On a phone they are the page (ChatList). */
function Recent({ list, current, onOpen }: { list: PagedResult<AiConversation>; current: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3">
      <CardHeader title="Recent" className="px-3.5" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataView<AiConversation>
          bare
          list={list}
          caption="Recent"
          noun="conversation"
          rowKey={(c) => c.ai_conversation_id}
          selectedKey={current}
          onRowClick={(c) => onOpen(c.ai_conversation_id)}
          empty={{ title: "No Questions Yet" }}
          columns={[
            { key: "title", label: "Conversation", render: (c) => c.title },
            { key: "last_asked_at", label: "Last Asked", render: (c) => (c.last_asked_at ? formatWhen(c.last_asked_at) : null) },
          ]}
        />
      </div>
    </div>
  );
}

/* ───────────────────────── History ───────────────────────── */

function History() {
  const { navigate } = useRouter();
  const confirm = useConfirm();
  const s = useApi("GET /api/v1/ai/history/summary");
  const list = usePaged("GET /api/v1/ai/history/questions");

  /** After a confirmation, one removal; a refusal is said in the toast. */
  const removing = async (ask: Parameters<typeof confirm>[0], work: () => Promise<unknown>, done: string) => {
    if (!(await confirm(ask))) return;
    try {
      await work();
      invalidate("/api/v1/ai");
      toast(done);
    } catch (e) {
      // Already deleted elsewhere: it is gone either way, so the list shows it gone.
      if (e instanceof ApiError && e.status === 404) {
        invalidate("/api/v1/ai");
        toast("That conversation was deleted");
      } else toast.error(e instanceof ApiError ? e.message : "Could not reach the server");
    }
  };
  const clear = () => removing({ title: "Clear History", body: "Every conversation is removed.", destructive: true }, () => api.call("DELETE /api/v1/ai/history"), "History cleared");
  const remove = (q: AiQuestion) =>
    removing({ title: "Delete Conversation", destructive: true }, () => api.call("DELETE /api/v1/ai/conversations/:id", { params: { id: q.ai_conversation_id } }), "Conversation deleted");
  const exportQuestions = () => saveExport(api.call("POST /api/v1/ai/history/export", { body: {} }));
  const exportFromMenu = async () => {
    try {
      if ((await exportQuestions()) !== false) toast("Export downloaded");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed. Try again.");
    }
  };

  const f = s.data;
  const company = f?.view === "company";
  const month = f ? formatMonth(f.month) : "";
  return (
    <>
      <PageHeader
        title="History"
        actions={
          <>
            <DesktopOnly>
              <ExportButton onExport={exportQuestions} />
              <Button icon="trash" onClick={clear}>
                Clear History
              </Button>
            </DesktopOnly>
            <PhoneOnly>
              <Menu
                trigger={(p) => <IconButton {...p} icon="dots" label="History Actions" />}
                items={[
                  { label: "Export", icon: "download", onSelect: () => void exportFromMenu() },
                  { label: "Clear History", icon: "trash", danger: true, onSelect: () => void clear() },
                ]}
              />
            </PhoneOnly>
          </>
        }
      />
      {f && (
        <KpiGrid cols={company ? 4 : 3} className="mb-3">
          <KpiCard title="Questions This Month" value={formatCount(f.questions_this_month)} caption={company ? `Everyone, ${month}` : month} />
          <KpiCard title="Your Questions" value={formatCount(f.your_questions)} caption={company ? month : "All Time"} />
          <KpiCard
            title={company ? "Spend" : "Your Spend"}
            value={formatMoney(f.spend_ngn)}
            caption={month}
            help={company ? "What Praxis AI cost this month, everyone's questions and recordings, priced as AI Control prices them." : "What your questions and recordings cost this month, priced as AI Control prices them."}
          />
          {company && (
            <KpiCard
              title="Monthly Cap"
              value={f.cap_ngn ? formatMoney(f.cap_ngn) : "No Cap"}
              tone={f.cap_ngn ? "ok" : undefined}
              caption="All AI"
              help="The most all AI may spend in a month. Set in AI Control."
            />
          )}
        </KpiGrid>
      )}
      <DataView<AiQuestion>
        title="Your Questions"
        list={list}
        search="Search Questions"
        rowKey={(q) => q.ai_message_id}
        noun="question"
        onRowClick={(q) => navigate(hrefFor("praxis_ai", "ask", { id: q.ai_conversation_id }))}
        empty={{ title: "No Questions Yet", text: "Ask one on the Ask tab." }}
        columns={[
          { key: "question", label: "Question", render: (q) => <span data-copy="content">{q.question}</span> },
          { key: "asked_at", label: "Asked", sortable: true, render: (q) => formatDateTime(q.asked_at) },
          { key: "sources", label: "Sources Read", desktop: true, render: (q) => (q.sources.length ? q.sources.join(", ") : "None") },
          { key: "tokens", label: "Tokens", align: "n", desktop: true, render: (q) => formatCount(q.tokens) },
          { key: "cost_ngn", label: "Cost", align: "n", render: (q) => formatMoney(q.cost_ngn) },
          {
            key: "act",
            label: "",
            render: (q) => (
              <Menu
                trigger={(p) => <IconButton {...p} size="sm" icon="dots" label="Question Actions" />}
                items={[{ label: "Delete Conversation", icon: "trash", danger: true, onSelect: () => void remove(q) }]}
              />
            ),
          },
        ]}
      />
      {f && (
        <DesktopOnly unmount>
          <Grid cols={2} className="mt-3">
            <AreaChart
              title="Spend per Month, Naira"
              values={f.spend_by_month.map((m) => Number(m.spend_ngn))}
              labels={f.spend_by_month.map((m) => monthName(Number(m.month.slice(5, 7)) - 1).slice(0, 3))}
              format={(v) => formatMoney(v.toFixed(2))}
              caption={company && f.cap_ngn ? `Against a ${formatMoney(f.cap_ngn)} monthly cap` : undefined}
            />
            <BarsCard
              title="Questions by Module"
              rows={f.by_module.map((m) => ({ label: m.label, value: String(m.questions), pct: Math.round((m.questions / Math.max(1, ...f.by_module.map((x) => x.questions))) * 100) }))}
            />
          </Grid>
        </DesktopOnly>
      )}
    </>
  );
}
