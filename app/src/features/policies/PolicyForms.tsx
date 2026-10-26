import policies from "@mycity/contract/schemas/policies.js";
import type { Policy } from "@mycity/contract/contract.gen.ts";
import { useRef, type RefObject } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, DateField, Field, FormFooter, SignatureField, TextAreaField, toast, todayIso, useContractForm, type ContractSchema, type SignatureFieldHandle } from "@mycity/ui";
import { WhatChanged } from "./PolicyText";

/**
 * The sheets a policy is sent, approved or stopped with (docs/guides/policies.md §6.3 to §6.5):
 * Publish Policy or Submit for Approval (first day, note, signature), Approve Policy (signature),
 * and the reasons for Withdraw, Recall, Archive and Reject. Each validates with the contract's
 * schema; the signature is the pad's PNG, read when the form is checked.
 */

/** The contract's schema with the pad's PNG put in for `signature`, and a plain mark when it is empty. */
function withSignature(schema: ContractSchema, pad: RefObject<SignatureFieldHandle | null>): ContractSchema {
  return {
    safeParse: (value: unknown) => {
      const v = value as Record<string, unknown>;
      const png = v.signature ? (pad.current?.toPng() ?? null) : null;
      const r = schema.safeParse({ ...v, signature: png ?? "" });
      if (r.success || png) return r;
      const others = (r.error?.issues ?? []).filter((i) => i.path[0] !== "signature");
      return { success: false, error: { issues: [...others, { path: ["signature"], message: "Sign in the box", code: "custom" }] } };
    },
  };
}

/**
 * A refusal on the sheet: its fields' marks, and the reason as a toast when no field on the sheet
 * holds it (an empty policy text is the editor's, not this sheet's).
 */
const failed = (e: unknown, fallback: string, setFields: (f: Record<string, string[]>) => void, bound: readonly string[]) => {
  if (e instanceof ApiError && Object.keys(e.fields).length) {
    setFields(e.fields);
    if (Object.keys(e.fields).some((k) => !bound.includes(k))) toast.error(e.message);
  } else toast.error(e instanceof ApiError ? e.message : fallback);
};

/** The day after an ISO date. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Publish Policy (no approval) or Submit for Approval: the changes, the first day, a note, the signature. */
export function SendForm({ p, close }: { p: Policy; close: () => void }) {
  const draft = p.draft!;
  const approval = draft.needs_approval;
  const pad = useRef<SignatureFieldHandle>(null);
  const publish = useMutation("POST /api/v1/policies/:id/publish");
  const submitIt = useMutation("POST /api/v1/policies/:id/submit");
  const first = p.waiting ? nextDay(p.waiting.effective_from) : todayIso();
  const f = useContractForm({ effective_from: first, note: "", signature: "" }, withSignature(policies.PolicyPublish, pad));
  const send = async () => {
    if (!f.check()) return;
    const body = { effective_from: f.values.effective_from, note: f.values.note.trim(), signature: pad.current?.toPng() ?? "" };
    try {
      const out = approval
        ? await submitIt.run({ params: { id: p.policy_id }, body })
        : await publish.run({ params: { id: p.policy_id }, body });
      invalidate("/api/v1/policies");
      close();
      const v = out.waiting ?? out.in_force;
      toast(approval ? "Sent for approval" : v ? `Version ${v.version} published` : "Policy published");
    } catch (e) {
      failed(e, approval ? "Not sent, try again" : "Not published, try again", f.setServerErrors, ["effective_from", "note", "signature"]);
    }
  };
  return (
    <>
      <WhatChanged lines={draft.change_lines} />
      <Field label="First Day" {...f.status("effective_from")}>
        <DateField {...f.field("effective_from")} min={todayIso()} />
      </Field>
      <Field label="Note" {...f.status("note")}>
        <TextAreaField {...f.field("note")} placeholder="Grace now 10" rows={3} />
      </Field>
      <Field label="Your Signature" {...f.status("signature")}>
        <SignatureField ref={pad} label="Your Signature" onChange={(ink) => f.set("signature", ink ? "drawn" : "")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          {approval ? "Submit for Approval" : "Publish Policy"}
        </Button>
      </FormFooter>
    </>
  );
}

/** Approve Policy: the approver's signature, for the stage waiting on them. */
export function ApproveForm({ versionId, close, onDone }: { versionId: string; close: () => void; onDone: () => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const approve = useMutation("POST /api/v1/policies/me/versions/:id/approve");
  const f = useContractForm({ signature: "" }, withSignature(policies.PolicyApprove, pad));
  const send = async () => {
    if (!f.check()) return;
    try {
      await approve.run({ params: { id: versionId }, body: { signature: pad.current?.toPng() ?? "" } });
      invalidate("/api/v1/policies");
      close();
      onDone();
      toast("Policy approved");
    } catch (e) {
      failed(e, "Not approved, try again", f.setServerErrors, ["signature"]);
    }
  };
  return (
    <>
      <Field label="Your Signature" {...f.status("signature")}>
        <SignatureField ref={pad} label="Your Signature" onChange={(ink) => f.set("signature", ink ? "drawn" : "")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={send}>
          Approve Policy
        </Button>
      </FormFooter>
    </>
  );
}

/** A reason, then the action: Withdraw Version, Recall Submission, Archive Policy, Reject Policy. */
export function ReasonForm({
  action,
  placeholder,
  danger,
  done,
  run,
  close,
}: {
  action: string;
  placeholder: string;
  danger?: boolean;
  done: string;
  run: (reason: string) => Promise<unknown>;
  close: () => void;
}) {
  const f = useContractForm({ reason: "" }, policies.PolicyReason);
  const send = async () => {
    if (!f.check()) return;
    try {
      await run(f.values.reason.trim());
      invalidate("/api/v1/policies");
      close();
      toast(done);
    } catch (e) {
      failed(e, "Not done, try again", f.setServerErrors, ["reason"]);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder={placeholder} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={send}>
          {action}
        </Button>
      </FormFooter>
    </>
  );
}
