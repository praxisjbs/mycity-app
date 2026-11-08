import { useState } from "react";
import type { ProposalDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useMutation } from "@/api/hooks";
import { ActionGroup, Button, QuestionCard, SegmentedControl, toast, useIsPhone, type QuestionAnswer } from "@mycity/ui";
import { fail } from "../lib";

/** The cards' groups as the screen names them (§6.10 step 2). */
export const GROUPS: Record<string, string> = { partner: "The Partner", offer: "The Offer", audience: "Audience and Reach", money: "Money", timing: "Timing", proof: "Proof" };

/**
 * The studio's Questions (docs/guides/partnerships.md §6.10 step 2): Claude's cards by group with their
 * progress; answer, Use Suggestion, Skip or Reshuffle (three a card at most); Write Draft once every
 * required card is answered. A phone shows one card at a time.
 */
export function Questions({ p, done }: { p: ProposalDetail; done: (next: ProposalDetail) => void }) {
  const phone = useIsPhone();
  const cards = p.questions.filter((q) => q.state !== "replaced");
  const [at, setAt] = useState(() => Math.max(0, cards.findIndex((q) => q.state === "open")));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const answer = useMutation("POST /api/v1/partnerships/proposals/:id/questions/:qid/answer");
  const skip = useMutation("POST /api/v1/partnerships/proposals/:id/questions/:qid/skip");
  const reshuffle = useMutation("POST /api/v1/partnerships/proposals/:id/questions/:qid/reshuffle");
  const draft = useMutation("POST /api/v1/partnerships/proposals/:id/draft");
  const answered = cards.filter((q) => q.state !== "open").length;
  const groups = [...new Set(cards.map((q) => q.group_key))];
  const [group, setGroup] = useState<string>(groups[0] ?? "partner");

  const after = (next: ProposalDetail) => {
    invalidate("/api/v1/partnerships/proposals");
    done(next);
  };
  const run = async (key: string, work: () => Promise<ProposalDetail>) => {
    try {
      const next = await work();
      setErrors((e) => ({ ...e, [key]: "" }));
      after(next);
      if (phone) setAt((i) => Math.min(i + 1, next.questions.filter((q) => q.state !== "replaced").length - 1));
    } catch (e) {
      const word = (e as { fields?: Record<string, string[]> }).fields?.answer?.[0];
      if (word) setErrors((x) => ({ ...x, [key]: word }));
      else fail(e);
    }
  };
  const params = (qid: string) => ({ params: { id: p.partnership_proposal_id, qid } });
  const write = async () => {
    try {
      after(await draft.run({ params: { id: p.partnership_proposal_id } }));
      toast("Writing the draft");
    } catch (e) {
      fail(e);
    }
  };

  const card = (q: (typeof cards)[number], i: number) => (
    <QuestionCard
      key={q.proposal_question_id}
      group={GROUPS[q.group_key] ?? q.group_key}
      position={`${i + 1} of ${cards.length}`}
      question={q.question}
      why={q.why}
      kind={q.answer_kind}
      options={q.options}
      suggested={q.suggested}
      suggestedFrom={q.suggested_from}
      required={q.required}
      answer={q.answer}
      state={q.state === "replaced" ? "open" : q.state}
      error={errors[q.proposal_question_id] || null}
      onAnswer={(value: QuestionAnswer) => run(q.proposal_question_id, () => answer.run({ ...params(q.proposal_question_id), body: { answer: value } }))}
      onSkip={q.required ? undefined : () => run(q.proposal_question_id, () => skip.run({ ...params(q.proposal_question_id), body: {} }))}
      onReshuffle={q.reshuffles < 3 && q.state === "open" && p.ai === "on" ? () => run(q.proposal_question_id, () => reshuffle.run({ ...params(q.proposal_question_id), body: {} })) : undefined}
    />
  );

  if (phone) {
    const q = cards[Math.min(at, cards.length - 1)];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{`${answered} of ${cards.length} answered`}</p>
        {q && card(q, cards.indexOf(q))}
        <ActionGroup>
          <div className="flex gap-2">
            <Button block icon="left" onClick={() => setAt((i) => Math.max(0, i - 1))}>Previous</Button>
            <Button block iconRight="right" onClick={() => setAt((i) => Math.min(cards.length - 1, i + 1))}>Next</Button>
          </div>
        </ActionGroup>
        <Button variant="primary" block icon="spark" onClick={write}>Write Draft</Button>
      </div>
    );
  }

  const shown = cards.filter((q) => q.group_key === group);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {groups.length > 1 && groups.length <= 5 ? (
          <SegmentedControl value={group} onChange={setGroup} options={groups.map((g) => [g, GROUPS[g] ?? g] as [string, string])} label="Group" small />
        ) : (
          <span className="text-sm font-semibold text-foreground">{GROUPS[group] ?? group}</span>
        )}
        <span className="text-sm text-muted-foreground tabular-nums">{`${answered} of ${cards.length} answered`}</span>
      </div>
      {groups.length > 5 && (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <Button key={g} size="sm" variant={g === group ? "default" : "ghost"} onClick={() => setGroup(g)}>
              {GROUPS[g] ?? g}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-3">{shown.map((q) => card(q, cards.indexOf(q)))}</div>
      <div className="flex justify-end">
        <Button variant="primary" icon="spark" onClick={write}>Write Draft</Button>
      </div>
    </div>
  );
}
