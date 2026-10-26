import { useCallback } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, refresh, useApi, usePaged, type PagedResult } from "@/api/hooks";
import type { AiConversation } from "@mycity/contract/contract.gen.ts";
import { useRouter, useSearchParams } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import { moduleByKey } from "@/shell/catalogue";
import { useFitPage } from "@/shell/layout-context";
import { useScreenAction } from "@/shell/screen-action";
import type { ModuleScreenProps } from "@/shell/screens";
import { BarsCard } from "@/features/shared/sections";
import { Conversation } from "./Conversation";
import {
  Button,
  CardHeader,
  DataView,
  DesktopOnly,
  formatDateTime,
  formatMonth,
  formatWhen,
  Grid,
  IconButton,
  KpiCard,
  KpiGrid,
  Menu,
  PageHeader,
  PhoneOnly,
  SplitPanes,
  toast,
  useConfirm,
  useIsMobile,
  useSplitPanes,
} from "@mycity/ui";

/** Praxis AI, Ask and History (docs/guides/praxis-ai.md §10). It reads what the person may see and never writes. */
export default function Assistant({ tab, id }: ModuleScreenProps) {
  return tab === "history" ? <History /> : <Ask id={id} />;
}

/** The assistant's name, written once in the shell's catalogue (§1.1 decision 5). */
const NAME = moduleByKey("praxis_ai")?.label ?? "Assistant";

/* ───────────────────────── Ask ───────────────────────── */

function Ask({ id }: { id: string | null }) {
  const mobile = useIsMobile();
  useFitPage(true);
  const { navigate } = useRouter();
  const [, setParams] = useSearchParams();
  const split = useSplitPanes("praxis-ai", 280);
  const recent = usePaged("GET /api/v1/ai/conversations", { enabled: !mobile });
  const open = useCallback((next: string) => setParams({ id: next }), [setParams]);
  // A new address rather than a change to this one: ⌘K's New Conversation arrives as ?action=new,
  // which a change made from this render's address would put back.
  const fresh = useCallback(() => navigate(hrefFor("praxis_ai", "ask")), [navigate]);
  // A fit page has no floating button: ⌘K's New Conversation (?action=new) runs this.
  useScreenAction({ label: "New Conversation", onSelect: fresh });
  const reloadRecent = recent.reload;
  const answered = useCallback(() => {
    if (!mobile) void reloadRecent();
    void refresh("/api/v1/ai/history");
  }, [mobile, reloadRecent]);

  const conversation = <Conversation id={id} onOpened={(next) => setParams({ id: next }, { replace: true })} onGone={fresh} onAnswered={answered} />;
  return (
    <>
      <PageHeader title={NAME} actions={id ? <Button icon="plus" onClick={fresh}>New Conversation</Button> : undefined} />
      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-card">{conversation}</div>
      ) : (
        <SplitPanes split={split} open list={<Recent list={recent} current={id} onOpen={open} />} detail={conversation} />
      )}
    </>
  );
}

/** Beside the conversation on desktop: the person's conversations, newest first. On a phone this is History. */
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
  const list = usePaged("GET /api/v1/ai/conversations");

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
  const remove = (c: AiConversation) =>
    removing({ title: "Delete Conversation", destructive: true }, () => api.call("DELETE /api/v1/ai/conversations/:id", { params: { id: c.ai_conversation_id } }), "Conversation deleted");

  return (
    <>
      <PageHeader
        title="History"
        actions={
          <>
            <DesktopOnly>
              <Button icon="trash" onClick={clear}>
                Clear History
              </Button>
            </DesktopOnly>
            <PhoneOnly>
              <Menu trigger={(p) => <IconButton {...p} icon="dots" label="History Actions" />} items={[{ label: "Clear History", icon: "trash", danger: true, onSelect: () => void clear() }]} />
            </PhoneOnly>
          </>
        }
      />
      {s.data && (
        <KpiGrid cols={3} className="mb-3">
          <KpiCard title="Questions" value={String(s.data.questions_this_month)} caption={formatMonth(s.data.month)} />
          <KpiCard title="Conversations" value={String(s.data.conversations)} caption={formatMonth(s.data.month)} />
          <KpiCard title="Records Read" value={String(s.data.rows_read_this_month)} caption={formatMonth(s.data.month)} help="How many records this month's answers were read from." />
        </KpiGrid>
      )}
      <DataView<AiConversation>
        title="Conversations"
        list={list}
        search="Search Conversations"
        rowKey={(c) => c.ai_conversation_id}
        noun="conversation"
        onRowClick={(c) => navigate(hrefFor("praxis_ai", "ask", { id: c.ai_conversation_id }))}
        empty={{ title: "No Questions Yet", text: "Ask one on the Ask tab." }}
        columns={[
          { key: "title", label: "Title", sortable: true, render: (c) => c.title },
          { key: "last_asked_at", label: "Last Asked", sortable: true, render: (c) => (c.last_asked_at ? formatDateTime(c.last_asked_at) : null) },
          { key: "questions", label: "Questions", align: "n", render: (c) => String(c.questions) },
          { key: "rows_read", label: "Records Read", align: "n", desktop: true, render: (c) => String(c.rows_read) },
          {
            key: "act",
            label: "",
            render: (c) => (
              <Menu
                trigger={(p) => <IconButton {...p} size="sm" icon="dots" label="Conversation Actions" />}
                items={[{ label: "Delete Conversation", icon: "trash", danger: true, onSelect: () => void remove(c) }]}
              />
            ),
          },
        ]}
      />
      {s.data && s.data.by_module.length > 0 && (
        <DesktopOnly unmount>
          <Grid cols={2} className="mt-3">
            <BarsCard
              title="Questions by Module"
              rows={s.data.by_module.map((m) => ({ label: m.label, value: String(m.questions), pct: Math.round((m.questions / Math.max(1, s.data!.questions_this_month)) * 100) }))}
            />
          </Grid>
        </DesktopOnly>
      )}
    </>
  );
}
