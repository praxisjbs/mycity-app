import type { MyPolicyDue } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { signInAsked } from "@/features/attendance/prompts";
import { useRouter } from "@/lib/router";
import { Button, CardHeader, formatDate, FormFooter, KeyValue, toast, useModal } from "@mycity/ui";
import { WhatChanged } from "./PolicyText";

type DueItem = MyPolicyDue["items"][number];

/**
 * Rendered once by the shell, on both shells: the acknowledge sheet (docs/guides/policies.md §6.7).
 * Once the clock has been answered (a clock-in, or the sign-in prompt closed, or none due today) it
 * shows each policy version the person owes, oldest due first, one at a time: Acknowledge, Read
 * Full Policy, or Later before its due date. It never opens over the clock panel or another dialog
 * and never stops the clock. Each version shows once per sign-in; one put off returns tomorrow,
 * and one past its due date at every sign-in.
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
    const next = due.data.items.find((i) => !shown.current.has(i.policy_version_id));
    if (!next) return;
    shown.current.add(next.policy_version_id);
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
