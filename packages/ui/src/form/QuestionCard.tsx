/**
 * @component QuestionCard
 * @group Forms
 * @summary One question the Proposal Studio asks before a draft: the question, why it is asked, an answer field matched to its kind, a suggested answer with where it came from, and Skip and Reshuffle.
 * @use The studio's Questions step (docs/guides/partnerships.md §6.10): cards grouped (The Partner, The Offer, Audience and Reach, Money, Timing, Proof), answered one by one.
 * @avoid A form's ordinary field (use Field with its control); a yes or no setting (use Switch); a survey of many fields at once (use a Wizard).
 * @phone One card fills the width; the answer field is 16 px and every button a 44 px target, Save Answer full width with Skip and Reshuffle above it.
 * @a11y The question is the field's accessible name; Why is a help term beside it. Save Answer, Use Suggestion, Skip and Reshuffle are buttons that stay busy while their work runs (F26).
 * @status beta
 * @example <QuestionCard group="The Offer" question="What is the early bird price?" kind="money" state="open" onAnswer={(v) => answer(card, v)} />
 */
import { useEffect, useId, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";
import { ActionGroup } from "../actions/ActionGroup";
import { Pill } from "../display/Pill";
import { HelpTerm } from "../help/HelpTerm";
import { Chips } from "../navigation/Chips";
import { Field } from "./Field";
import { TextField, TextAreaField, NumberField } from "./TextField";
import { MoneyField } from "./MoneyField";
import { DateField } from "./DateField";
import { ChoiceField, SelectField } from "./SelectField";

/** How a card is answered. */
export type QuestionKind = "short_text" | "long_text" | "number" | "money" | "date" | "pick" | "multi_pick";
/** An answer or a suggestion as the API carries it: money a string with two decimals, a date ISO. */
export type QuestionAnswer = string | number | string[] | null;

export interface QuestionCardProps {
  /** The question, as Claude asked it. */
  question: string;
  /** Why it is asked, in one line, behind the Why help term; none when null. */
  why?: string | null;
  /** The card's group as the screen names it ("The Offer"). */
  group: string;
  /** The answer field it takes. */
  kind: QuestionKind;
  /** The choices of a pick or a multi-pick. */
  options?: readonly string[] | null;
  /** Claude's suggested answer, in the card's kind, or null. */
  suggested?: QuestionAnswer;
  /** Where the suggestion comes from ("From the transcript, 00:21:51"). */
  suggestedFrom?: string | null;
  /** A required card cannot be skipped. */
  required?: boolean;
  /** The answer kept, or null. */
  answer?: QuestionAnswer;
  /** Where the card stands. */
  state: "open" | "answered" | "skipped";
  /** The card's place among its group's or all cards ("3 of 9"). */
  position?: string;
  /** Keep an answer: hand back the save (F26). */
  onAnswer: (value: QuestionAnswer) => unknown;
  /** Skip the card; not offered on a required card. */
  onSkip?: () => unknown;
  /** A different question in its place; left out when none remain. */
  onReshuffle?: () => unknown;
  /** The server's word on the answer, at most 4 words. */
  error?: string | null;
  /** Layout classes only (spacing, width). */
  className?: string;
}

/** What the answer field holds for an answer of a kind. */
function draftOf(kind: QuestionKind, value: QuestionAnswer): string | string[] {
  if (kind === "multi_pick") return Array.isArray(value) ? value : [];
  if (value === null || value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** "250,000.5" as the API's "250000.50"; null when it is not an amount. */
export function moneyOf(typed: string): string | null {
  const plain = typed.replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(plain)) return null;
  const [whole, part = ""] = plain.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${`${part}00`.slice(0, 2)}`;
}

/** The answer the field holds, as the API takes it, or a word on what is wrong. */
function answerOf(kind: QuestionKind, draft: string | string[]): { value: QuestionAnswer } | { problem: string } {
  if (kind === "multi_pick") return Array.isArray(draft) && draft.length ? { value: draft } : { problem: "Pick at least one" };
  const text = String(draft).trim();
  if (!text) return { problem: "Give an answer" };
  if (kind === "number") {
    const n = Number(text.replace(/,/g, ""));
    return Number.isFinite(n) ? { value: n } : { problem: "Give a number" };
  }
  if (kind === "money") {
    const m = moneyOf(text);
    return m ? { value: m } : { problem: "Give an amount" };
  }
  return { value: text };
}

/** A suggestion as a person reads it. */
function shown(value: QuestionAnswer): string {
  if (value === null || value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function QuestionCard({
  question,
  why,
  group,
  kind,
  options,
  suggested = null,
  suggestedFrom,
  required = false,
  answer = null,
  state,
  position,
  onAnswer,
  onSkip,
  onReshuffle,
  error,
  className,
}: QuestionCardProps) {
  const [draft, setDraft] = useState<string | string[]>(() => draftOf(kind, answer));
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();
  useEffect(() => setDraft(draftOf(kind, answer)), [kind, answer]);
  const message = problem ?? error ?? null;
  const bound = { id: fieldId, name: "answer", state: message ? ("bad" as const) : undefined, message: message ?? undefined };
  const text = typeof draft === "string" ? draft : "";
  const choices = (options ?? []).map((o) => [o, o] as [string, string]);

  const save = async (from: string | string[] = draft) => {
    const out = answerOf(kind, from);
    if ("problem" in out) {
      setProblem(out.problem);
      return;
    }
    setProblem(null);
    await onAnswer(out.value);
  };
  const useSuggestion = async () => {
    const next = draftOf(kind, suggested);
    setDraft(next);
    await save(next);
  };

  const control = (() => {
    switch (kind) {
      case "long_text":
        return <TextAreaField {...bound} value={text} onChange={setDraft} rows={3} />;
      case "number":
        return <NumberField {...bound} value={text} onChange={setDraft} decimal />;
      case "money":
        return <MoneyField {...bound} value={text} onChange={setDraft} />;
      case "date":
        return <DateField {...bound} value={text} onChange={setDraft} />;
      case "pick":
        return choices.length >= 2 && choices.length <= 5 ? (
          <ChoiceField value={text} onChange={setDraft} options={choices} label={question} state={bound.state} />
        ) : (
          <SelectField {...bound} value={text} onChange={setDraft} options={choices} placeholder="Pick one" />
        );
      case "multi_pick":
        return <Chips label={question} options={choices} selected={Array.isArray(draft) ? draft : []} onSelectedChange={(v) => setDraft(v)} />;
      default:
        return <TextField {...bound} value={text} onChange={setDraft} />;
    }
  })();

  return (
    <article className={cn("rounded-card border border-border bg-card p-4 phone:p-3.5", className)} data-ui="question-card" data-state={state}>
      <header className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-eyebrow">{group}</span>
        <span className="flex items-center gap-2">
          {position && <span className="text-xs text-muted-foreground tabular-nums">{position}</span>}
          {state === "answered" ? (
            <Pill tone="ok">Answered</Pill>
          ) : state === "skipped" ? (
            <Pill>Skipped</Pill>
          ) : required ? (
            <Pill tone="warn">Required</Pill>
          ) : null}
        </span>
      </header>
      <p id={`${fieldId}-q`} className="mb-1 text-md font-semibold text-foreground" data-copy="content">
        {question}
      </p>
      {why && (
        <p className="mb-3 text-xs text-muted-foreground">
          <HelpTerm help={why}>Why</HelpTerm>
        </p>
      )}
      <Field label="Your Answer" optional={!required} htmlFor={fieldId} state={bound.state} message={message ?? undefined}>
        {control}
      </Field>
      {suggested !== null && suggested !== undefined && shown(suggested) && state !== "answered" && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-box bg-muted px-3 py-2 phone:flex-col phone:items-stretch">
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-muted-foreground">Suggested</span>
            <p className="text-sm text-foreground" data-copy="content">
              {shown(suggested)}
            </p>
            {suggestedFrom && (
              <p className="text-xs text-muted-foreground" data-copy="content">
                {suggestedFrom}
              </p>
            )}
          </div>
          <Button size="sm" icon="spark" onClick={useSuggestion}>
            Use Suggestion
          </Button>
        </div>
      )}
      <ActionGroup>
        <div className="flex flex-wrap items-center justify-end gap-2 phone:flex-col phone:items-stretch">
          {onReshuffle && (
            <Button variant="ghost" icon="refresh" onClick={onReshuffle}>
              Reshuffle
            </Button>
          )}
          {!required && onSkip && state !== "skipped" && (
            <Button variant="ghost" onClick={onSkip}>
              Skip
            </Button>
          )}
          <Button variant="primary" icon="tick" onClick={() => save()}>
            Save Answer
          </Button>
        </div>
      </ActionGroup>
    </article>
  );
}
