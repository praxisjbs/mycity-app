import { useState } from "react";
import { api, ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { usePaged } from "@/api/hooks";
import type { ForwardTarget } from "@/api/types/community";
import { Avatar, Button, FormError, FormFooter, RecordPicker, toast } from "@mycity/ui";

/** What a forward sends: messages from a conversation, or one mail attachment. */
export type ForwardSource = { message_ids: string[] } | { mail_attachment_id: string };

/** The kinds of message that travel (the contract's FORWARDABLE). */
const KINDS = new Set(["text", "image", "audio", "video", "file"]);
export const forwardable = (m: { message_type: string; deleted: boolean }) => !m.deleted && KINDS.has(m.message_type);

const MAX_CHATS = 5;
const keyOf = (t: ForwardTarget) => t.community_channel_id ?? `person:${t.employee_id}`;
const label = (t: ForwardTarget) => (t.kind === "channel" ? `#${t.name}` : t.name);

/**
 * Forward To (community.md §3 step 19): one search over the channels the person may post in,
 * their conversations and every colleague; up to 5 picked as chips; Forward sends to each.
 */
export function ForwardTo({ source, close, done }: { source: ForwardSource; close: () => void; done?: () => void }) {
  const list = usePaged("GET /api/v1/community/forward-targets");
  const photo = usePhotos(list.rows.map((t) => t.person?.photo_url));
  const [picked, setPicked] = useState<ForwardTarget[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = (rows: ForwardTarget[]) => {
    if (rows.length > MAX_CHATS) {
      setProblem("At most 5 chats");
      return;
    }
    setProblem(null);
    setPicked(rows);
  };
  const send = async () => {
    if (!picked.length) {
      setProblem("Choose a chat");
      return;
    }
    const channel_ids = picked.flatMap((t) => (t.community_channel_id ? [t.community_channel_id] : []));
    const employee_ids = picked.flatMap((t) => (!t.community_channel_id && t.employee_id ? [t.employee_id] : []));
    try {
      const res = await api.call("POST /api/v1/community/forward", {
        body: { ...source, ...(channel_ids.length ? { channel_ids } : {}), ...(employee_ids.length ? { employee_ids } : {}) },
        idempotencyKey: crypto.randomUUID(),
      });
      const n = res.community_channel_ids.length;
      toast(n === 1 ? "Forwarded" : `Forwarded to ${n} chats`);
      close();
      done?.();
    } catch (e) {
      if (e instanceof ApiError) setProblem(e.message);
      else throw e;
    }
  };
  return (
    <>
      <RecordPicker
        list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
        value={picked}
        onChange={pick}
        id={keyOf}
        title={label}
        sub={(t) => (t.kind === "channel" ? "Channel" : t.kind === "direct" ? "Direct Message" : (t.person?.job_title ?? "Colleague"))}
        lead={(t) =>
          t.kind === "channel" ? (
            <span className="flex size-8 flex-none items-center justify-center rounded-box bg-muted font-strong text-subtle-foreground">#</span>
          ) : (
            <Avatar name={t.name} src={photo(t.person?.photo_url)} size={32} />
          )
        }
        chip={label}
        multiple
        placeholder="Search chats"
      />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="forward" onClick={send}>
          Forward
        </Button>
      </FormFooter>
    </>
  );
}
