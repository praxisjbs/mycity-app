import type { MyPolicyDue } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef } from "react";
import { ApiError, session } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { signInAsked } from "@/features/attendance/prompts";
import { useRouter } from "@/lib/router";
import { Button, CardHeader, formatDate, FormFooter, KeyValue, toast, useModal } from "@mycity/ui";
import { WhatChanged } from "./PolicyText";

type DueItem = MyPolicyDue["items"][number];

/** Where this tab keeps the versions it has shown, with the session they were shown in. */
const SHOWN_KEY = "mc-policy-shown";

/**
 * The sign-in this tab is in: the access token's `sid` claim (identity.service.js signs it into
 * every access token of the session, and a refresh keeps it). Read only to key what was shown;
 * the server decides everything else. Null for a token that carries none.
 */
export function sessionOf(token: string | null): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sid?: unknown };
    return typeof claims.sid === "string" && claims.sid ? claims.sid : null;
  } catch {
    return null;
  }
}

/** The versions shown in this sign-in, from this tab's session storage; none for another sign-in. */
export function shownIn(sid: string): Set<string> {
  try {
    const kept = JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "null") as { sid?: string; ids?: unknown } | null;
    return new Set(kept && kept.sid === sid && Array.isArray(kept.ids) ? kept.ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    // Storage refused (a private window) or spoiled: what this page remembers in memory still holds.
    return new Set();
  }
}

/** Notes a version as shown in this sign-in, so a reload or a typed address does not show it again. */
export function markShown(sid: string, id: string): void {
  try {
    const ids = shownIn(sid);
    ids.add(id);
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify({ sid, ids: [...ids] }));
  } catch {
    /* storage refused: the page's own memory keeps it until it reloads */
  }
}

/**
 * Rendered once by the shell, on both shells: the acknowledge sheet (docs/guides/policies.md §6.7).
 * Once the clock has been answered (a clock-in, or the sign-in prompt closed, or none due today) it
 * shows each policy version the person owes, oldest due first, one at a time: Acknowledge, Read
 * Full Policy, or Later before its due date. It never opens over the clock panel or another dialog
 * and never stops the clock. Each version shows once per sign-in; one put off returns tomorrow,
 * and one past its due date at every sign-in. What was shown is kept in the tab's session storage
 * under the sign-in's session (sessionOf), so a reload, a typed address or a link opened in the tab
 * shows nothing again until the person signs in afresh; a browser that refuses storage remembers
 * it for as long as the page is open.
 */
export function AcknowledgePrompts() {
  const me = useMe();
  const { status } = useAuth();
  const modal = useModal();
  const today = useApi("GET /api/v1/attendance/me/today");
  const due = useApi("GET /api/v1/policies/me/due");
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!due.data || modal.isOpen || status !== "signed-in") return;
    const t = today.data;
    if (!t && !today.error) return;
    // The clock first: wait while the day's first sign-in prompt is still to come.
    const answered = !t || t.state !== "not_clocked_in" || !t.sign_in_prompt || signInAsked(me.user_id, t.date);
    if (!answered) return;
    const sid = sessionOf(session.token);
    const before = sid ? shownIn(sid) : new Set<string>();
    const next = due.data.items.find((i) => !shown.current.has(i.policy_version_id) && !before.has(i.policy_version_id));
    if (!next) return;
    shown.current.add(next.policy_version_id);
    if (sid) markShown(sid, next.policy_version_id);
    modal.open({ title: "Policy Update", dismissible: false, body: (close) => <AcknowledgeCard item={next} close={close} /> });
  }, [due.data, today.data, today.error, modal, status, me.user_id]);
  return null;
}

function AcknowledgeCard({ item, close }: { item: DueItem; close: () => void }) {
  const { navigate } = useRouter();
  const ack = useMutation("POST /api/v1/policies/me/versions/:id/acknowledge");
  const later = useMutation("POST /api/v1/policies/me/versions/:id/later");
  const acknowledge = async () => {
    try {
      await ack.run({ params: { id: item.policy_version_id }, body: {} });
      close();
      invalidate("/api/v1/policies/me");
      toast(`${item.title} acknowledged`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not acknowledged, try again");
    }
  };
  const putOff = async () => {
    try {
      await later.run({ params: { id: item.policy_version_id }, body: {} });
      close();
      invalidate("/api/v1/policies/me");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Try again");
    }
  };
  const read = () => {
    close();
    navigate(`/ess?tab=policy-updates&version=${item.policy_version_id}`);
  };
  return (
    <>
      <CardHeader title={item.title} record level={3} />
      <KeyValue
        items={[
          ["Version", item.first ? "New Policy" : `Version ${item.version}`],
          ["Due", item.overdue ? `Overdue since ${formatDate(item.due_on)}` : formatDate(item.due_on)],
        ]}
      />
      <div className="mt-2">
        <WhatChanged lines={item.change_lines} />
      </div>
      <FormFooter>
        {item.can_later && (
          <Button variant="ghost" onClick={putOff}>
            Later
          </Button>
        )}
        <Button onClick={read}>Read Full Policy</Button>
        <Button variant="primary" icon="ok" onClick={acknowledge}>
          Acknowledge
        </Button>
      </FormFooter>
    </>
  );
}
