import { useCallback, useState } from "react";
import { api, ApiError } from "@/api/client";
import { refresh } from "@/api/hooks";
import { useFreshSignIn, type ConfirmedWay } from "@/auth/FreshSignIn";
import { createPasskey, passkeyCancelled, passkeyProblem, passkeysWork } from "@/auth/passkey";
import { schemas, type AiActionCard, type AiActionResult } from "@mycity/contract/contract.gen.ts";
import { hrefFor } from "@/lib/routes";
import { useRouter } from "@/lib/router";
import { ActionCard, toast, type ContractSchema } from "@mycity/ui";

/**
 * An answer's action card, wired to the API (docs/guides/praxis-ai.md §6.11): the card as the API
 * drew it, Edit re-validated with PUT /ai/cards/:id, the press through POST /ai/cards/:id/confirm
 * with an Idempotency-Key, Cancel, and Draw It Again (the question asked afresh). A sensitive
 * class (decision 11) is pressed through Confirm It's You: the API answers 403 REAUTH_REQUIRED,
 * the person confirms (a passkey first, else the PIN, else the password) and the press goes
 * again. A person who confirmed with the PIN or the password and has no passkey is offered Set
 * Passkey once on this device.
 */

/** The key under which this device remembers that Set Passkey was offered. */
export const PASSKEY_OFFERED = "praxis-ai:passkey-offered";

/** Refusals a screen answers: the press names the screen that makes it possible. */
const SCREEN_FOR: Record<string, { label: string; href: string }> = {
  NO_MAILBOX: { label: "Open Mailbox", href: hrefFor("mailbox", "inbox") },
  MAIL_AUTH_FAILED: { label: "Open Mailbox", href: hrefFor("mailbox", "inbox") },
};

/** The action's contract schema, by the name the card carries ("tasks.TaskCreate"); undefined when the build lacks it. */
export function schemaOf(name: string): ContractSchema | undefined {
  const [domain, schema] = name.split(".");
  const group = (schemas as Record<string, Record<string, unknown>>)[domain ?? ""];
  const found = group?.[schema ?? ""];
  return found && typeof (found as ContractSchema).safeParse === "function" ? (found as ContractSchema) : undefined;
}

const offered = () => {
  try {
    return localStorage.getItem(PASSKEY_OFFERED) === "1";
  } catch {
    return true;
  }
};
const remember = () => {
  try {
    localStorage.setItem(PASSKEY_OFFERED, "1");
  } catch {
    /* a browser with no storage: the offer is made again next time */
  }
};

/** Set Passkey, offered once to a person who confirmed another way and has none (decision 11). */
async function offerPasskey(way: ConfirmedWay) {
  if (way === "passkey" || offered() || !passkeysWork()) return;
  const methods = await api.call("GET /api/v1/security").catch(() => null);
  if (!methods || methods.passkeys > 0) return;
  remember();
  toast.info("Set a passkey for next time", {
    action: {
      label: "Set Passkey",
      onClick: () => void setPasskey(),
    },
  });
}

async function setPasskey() {
  try {
    const start = await api.call("POST /api/v1/security/passkeys/options", { body: {} });
    const credential = await createPasskey(start.options);
    await api.call("POST /api/v1/security/passkeys", { body: { challenge_token: start.challenge_token, credential } });
    toast("Passkey added");
  } catch (e) {
    if (passkeyCancelled(e)) return;
    toast.error(e instanceof ApiError ? e.message : passkeyProblem(e));
  }
}

export function AnswerCard({ card: drawn, onRedraw }: { card: AiActionCard; onRedraw?: () => Promise<unknown> | undefined }) {
  const { navigate } = useRouter();
  const [card, setCard] = useState<AiActionCard>(drawn);
  const [problem, setProblem] = useState<{ message: string; code: string } | null>(null);
  const fresh = useFreshSignIn({ onConfirmed: (way) => void offerPasskey(way) });
  const id = card.ai_action_draft_id;

  const refused = useCallback(
    (e: unknown) => {
      const err = e instanceof ApiError ? e : new ApiError(0, null);
      if (err.status === 409 && err.code === "CARD_EXPIRED") setCard((c) => ({ ...c, status: "expired" }));
      else if (err.status === 409 && (err.code === "CARD_DONE" || err.code === "CARD_RUNNING" || err.code === "CARD_CANCELLED")) void api.call("GET /api/v1/ai/cards/:id", { params: { id } }).then(setCard, () => undefined);
      if (Object.keys(err.fields).length) setCard((c) => ({ ...c, problems: Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v ?? []])) }));
      setProblem({ message: err.message || "Could not reach the server", code: err.code });
    },
    [id],
  );

  const save = async (values: Record<string, unknown>) => {
    setProblem(null);
    try {
      setCard(await api.call("PUT /api/v1/ai/cards/:id", { params: { id }, body: { values } }));
    } catch (e) {
      refused(e);
    }
  };

  const press = async () => {
    setProblem(null);
    const key = crypto.randomUUID();
    try {
      const result: AiActionResult | undefined = await fresh.guard(() => api.call("POST /api/v1/ai/cards/:id/confirm", { params: { id }, body: {}, idempotencyKey: key }));
      if (!result) return;
      setCard((c) => ({ ...c, status: result.status, result, problems: {} }));
      // The screen underneath (a board, a list) shows the change in place, quietly (F28).
      void refresh("/api/v1");
    } catch (e) {
      refused(e);
    }
  };

  const cancel = async () => {
    setProblem(null);
    try {
      setCard(await api.call("POST /api/v1/ai/cards/:id/cancel", { params: { id }, body: {} }));
    } catch (e) {
      refused(e);
    }
  };

  const screen = problem ? SCREEN_FOR[problem.code] : undefined;
  return (
    <ActionCard
      label={card.label}
      fields={card.fields}
      values={card.values}
      problems={card.problems}
      records={card.records}
      status={card.status}
      confirm={card.confirm}
      suggested={card.suggested}
      result={card.result}
      schema={schemaOf(card.schema)}
      onConfirm={press}
      onCancel={cancel}
      onSave={save}
      onRedraw={onRedraw}
      onOpen={navigate}
      problem={problem?.message ?? null}
      problemAction={screen ? { label: screen.label, onPress: () => navigate(screen.href) } : null}
    />
  );
}
