import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refresh } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { contextOf } from "./context";
import { ChatPage } from "./PhoneChat";

/**
 * Praxis AI over the screen the person is on (docs/guides/praxis-ai.md §10.2): the phone's floating
 * button opens it. The conversation is kept while the app is open, so the button comes back to it;
 * Conversations switches to another and New Conversation starts one. The screen underneath is the
 * question's context (decision 12). Going anywhere (an answer's screen button, a record it was
 * read from) closes it, and the screen behind stays as it was left.
 */
export default function AskPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [id, setId] = useState<string | null>(null);
  const { location } = useRouter();
  const at = `${location.path}?${location.params.toString()}`;
  const context = useMemo(() => contextOf(at), [at]);
  const last = useRef(at);
  useEffect(() => {
    if (at === last.current) return;
    last.current = at;
    if (open) onClose();
  }, [at, open, onClose]);
  const answered = useCallback(() => void refresh("/api/v1/ai/history", "/api/v1/ai/conversations"), []);
  const fresh = useCallback(() => setId(null), []);

  return <ChatPage open={open} id={id} context={context} onClose={onClose} onOpen={setId} onNew={fresh} onAnswered={answered} />;
}
