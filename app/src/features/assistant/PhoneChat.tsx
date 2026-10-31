import { usePaged, type PagedResult } from "@/api/hooks";
import type { AiConversation } from "@mycity/contract/contract.gen.ts";
import { moduleByKey } from "@/shell/catalogue";
import { Button, EmptyState, ErrorState, formatWhen, Icon, IconButton, LoadingRows, Pager, PhonePage, plural, SearchInput, TapList, useModal } from "@mycity/ui";
import { Conversation } from "./Conversation";

/**
 * Praxis AI's chat on a phone (docs/guides/praxis-ai.md §3 step 8, §10.2): a conversation full
 * screen, with the person's other conversations a tap away as a sheet (the way Staff Community
 * switches channels inside a channel) and New Conversation beside it. Ask opens it over the list of
 * conversations; the floating button opens it over any screen (AskPanel).
 */

const NAME = moduleByKey("praxis_ai")?.label ?? "Assistant";

/** The person's conversations, newest first, 25 a page; the open one is ticked. */
export function ChatList({ list, current, onOpen }: { list: PagedResult<AiConversation>; current?: string | null; onOpen: (id: string) => void }) {
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  return (
    <>
      <SearchInput value={list.q} onChange={list.setQ} placeholder="Search conversations" label="Search Conversations" className="mb-3" />
      {list.loading && !list.rows.length ? (
        <LoadingRows count={4} />
      ) : list.rows.length ? (
        <div data-copy="content">
          <TapList
            label="Conversations"
            items={list.rows.map((c) => ({
              key: c.ai_conversation_id,
              title: c.title ?? "Conversation",
              sub: `${plural(c.questions, "question")} · ${formatWhen(c.last_asked_at)}`,
              end: c.ai_conversation_id === current ? <Icon name="tick" label="Open" className="text-accent-foreground" /> : undefined,
              onSelect: () => onOpen(c.ai_conversation_id),
            }))}
          />
        </div>
      ) : (
        <EmptyState bare title={list.q ? "No Conversation Matches" : "No Conversations Yet"} text={list.q ? undefined : "Start one with New Conversation."} />
      )}
      <Pager page={list.page} onPage={list.setPage} noun="conversation" />
    </>
  );
}

/** Inside a chat: the conversations as a sheet, New Conversation at its head. */
function ChatSheet({ current, onOpen, onNew }: { current: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const list = usePaged("GET /api/v1/ai/conversations");
  return (
    <>
      <Button icon="plus" className="mb-3 w-full" onClick={onNew}>
        New Conversation
      </Button>
      <ChatList list={list} current={current} onOpen={onOpen} />
    </>
  );
}

/**
 * The chat itself: Back, Conversations, and New Conversation once one is open; the conversation
 * fills the page with the box pinned at its foot. `id` null is a new conversation.
 */
export function ChatPage({
  open,
  id,
  onClose,
  onOpen,
  onNew,
  onAnswered,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onAnswered: () => void;
}) {
  const modal = useModal();
  const switchTo = () =>
    modal.open({
      title: "Conversations",
      body: (close) => (
        <ChatSheet
          current={id}
          onOpen={(next) => {
            close();
            onOpen(next);
          }}
          onNew={() => {
            close();
            onNew();
          }}
        />
      ),
    });
  return (
    <PhonePage
      open={open}
      onClose={onClose}
      title={NAME}
      actions={
        <>
          <IconButton icon="menu" label="Conversations" onClick={switchTo} />
          {id && <IconButton icon="plus" label="New Conversation" onClick={onNew} />}
        </>
      }
      bodyClassName="flex flex-col overflow-hidden"
    >
      <Conversation id={id} onOpened={onOpen} onGone={onNew} onAnswered={onAnswered} />
    </PhonePage>
  );
}
