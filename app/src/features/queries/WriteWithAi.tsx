import queries from "@mycity/contract/schemas/queries.js";
import type { AiAvailability } from "@mycity/contract/contract.gen.ts";
import { useState, type ReactNode } from "react";
import { Button, Field, FormFooter, Icon, TextAreaField, toast, useContractForm } from "@mycity/ui";

/**
 * Write With AI on Raise a Query and the letter editor (docs/guides/queries.md §9), built like the
 * mailbox's: the AI step opens inside the form's own window, since modals never stack, and nothing
 * is kept. Use Draft hands the draft to the form, which the person still raises or saves.
 *
 * The button says so when AI cannot answer (AI Is Off, AI Limit Reached), and the form works as
 * before.
 */
const label = (s: AiAvailability | undefined) => (!s || s.available ? "Write With AI" : s.reason === "limit" ? "AI Limit Reached" : "AI Is Off");

/** Why there is no draft, as a toast. */
export const offToast = (reason: AiAvailability["reason"]) => toast(reason === "limit" ? "This month's AI budget is spent" : "Write With AI is off");

/** The button that opens the step, or says why it cannot. */
export function WriteWithAiButton({ status, open }: { status: AiAvailability | undefined; open: () => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <Button size="sm" variant="ghost" icon="spark" onClick={() => (status && !status.available ? offToast(status.reason) : open())}>
        {label(status)}
      </Button>
    </div>
  );
}

type Instruction = { instruction: string };
const asked = { safeParse: (v: unknown) => queries.QueryDraftRequest.pick({ instruction: true }).safeParse(v) };

/**
 * The step: What To Say, Write Draft, the draft in its frame, Try Again and Use Draft. `ask` sends
 * the instruction and hands back the draft, or null when there is none (its toast said why).
 */
export function WriteWithAiStep<D>({ ask, show, use, back }: { ask: (instruction: string) => Promise<D | null>; show: (draft: D) => ReactNode; use: (draft: D) => void; back: () => void }) {
  const f = useContractForm<Instruction>({ instruction: "" }, asked);
  const [draft, setDraft] = useState<D | null>(null);
  const write = async () => {
    if (!f.check()) return;
    const d = await ask(f.values.instruction.trim());
    if (d) setDraft(d);
  };
  return (
    <>
      <h3 data-ui="title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon name="spark" />
        Write With AI
      </h3>
      <Field label="What To Say" {...f.status("instruction")}>
        <TextAreaField {...f.field("instruction")} rows={3} />
      </Field>
      {draft && <div className="mb-3 rounded-box border border-border p-3">{show(draft)}</div>}
      <FormFooter>
        <Button icon="left" onClick={back}>
          Back
        </Button>
        {draft ? (
          <>
            <Button icon="refresh" onClick={write}>
              Try Again
            </Button>
            <Button variant="primary" icon="ok" onClick={() => use(draft)}>
              Use Draft
            </Button>
          </>
        ) : (
          <Button variant="primary" icon="spark" onClick={write}>
            Write Draft
          </Button>
        )}
      </FormFooter>
    </>
  );
}
