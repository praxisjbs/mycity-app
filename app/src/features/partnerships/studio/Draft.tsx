import { useEffect } from "react";
import type { ProposalDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useMutation } from "@/api/hooks";
import { ActionGroup, Banner, Button, ProgressBar, toast } from "@mycity/ui";
import { fail } from "../lib";

/** The writing job's steps as the screen names them (§6.10 step 3). */
const STEPS: Record<string, string> = { reading: "Reading", asking: "Asking", writing: "Writing", checking: "Checking Figures", laying_out: "Laying Out" };
const ORDER = ["reading", "writing", "checking", "laying_out"];

/**
 * The studio while Claude works (docs/guides/partnerships.md §6.10 steps 2 and 3): the job's step, read
 * again every few seconds until it lands; a failure keeps the brief and the answers and offers Try Again;
 * AI Is Off and AI Limit Reached leave the kit to be filled by hand from Write Draft. Write It Myself
 * fills the kit from the record while the questions are asked or once they failed, so a proposal never
 * waits on the AI (QA F62).
 */
export function Draft({ p, reload, done }: { p: ProposalDetail; reload: () => unknown; done: (next: ProposalDetail) => void }) {
  const retry = useMutation("POST /api/v1/partnerships/proposals/:id/retry");
  const byHand = useMutation("POST /api/v1/partnerships/proposals/:id/own-words");
  const running = Boolean(p.progress && !p.progress.failed);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [running, reload]);

  const again = async () => {
    try {
      done(await retry.run({ params: { id: p.partnership_proposal_id }, body: {} }));
      invalidate("/api/v1/partnerships/proposals");
      toast("Asked again");
    } catch (e) {
      fail(e);
    }
  };

  const own = async () => {
    try {
      done(await byHand.run({ params: { id: p.partnership_proposal_id }, body: {} }));
      invalidate("/api/v1/partnerships/proposals");
      toast("Draft ready to edit");
    } catch (e) {
      fail(e);
    }
  };
  // The cards are asked, or the draft failed and the proposal is back at its cards: it may be written by hand.
  const mine = p.status === "questions";

  if (p.progress?.failed) {
    const off = p.progress.reason === "off" || p.progress.reason === "limit";
    const action = off ? undefined : (
      <ActionGroup>
        {mine && <Button size="sm" onClick={own}>Write It Myself</Button>}
        <Button size="sm" onClick={again}>Try Again</Button>
      </ActionGroup>
    );
    return (
      <Banner tone={off ? "info" : "err"} icon="spark" action={action}>
        {p.progress.reason === "limit" ? "AI Limit Reached" : off ? "AI Is Off" : p.progress.job === "draft" ? "The draft did not finish" : "The questions did not arrive"}
      </Banner>
    );
  }
  if (!p.progress) return null;
  const step = p.progress.step;
  const at = Math.max(0, ORDER.indexOf(step));
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{p.progress.job === "draft" ? STEPS[step] ?? "Writing" : "Asking"}</span>
        {p.progress.job === "questions" && mine && <Button size="sm" onClick={own}>Write It Myself</Button>}
      </div>
      <ProgressBar value={p.progress.job === "draft" ? at + 1 : undefined} max={ORDER.length} label={p.progress.job === "draft" ? "Draft" : "Questions"} />
    </div>
  );
}
