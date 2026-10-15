/**
 * @component Wizard
 * @group Forms
 * @summary A long form in steps: one topic per step, a step indicator, Back and Next, and a last button that names the result.
 * @use More than six fields or more than one topic (FRONTEND_GUIDE §8.1): a vacancy, an employee, a policy.
 * @avoid Six fields or fewer (one modal form); steps that are not topics.
 * @phone Opens in a full-screen sheet; the indicator shows the step number and title; Next is full width at the bottom.
 * @a11y The current step is announced; the indicator marks it with aria-current; focus moves to the step's heading when it changes.
 * @status stable
 * @example <Wizard steps={steps} finish="Publish Vacancy" onFinish={publish} onCancel={close} />
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";
import { FormFooter } from "./Form";

/** One step: a topic and its fields. */
export interface WizardStep {
  /** The topic, Title Case, at most 4 words; also the step's key. */
  title: string;
  /** The step's fields. */
  body: ReactNode;
  /** Marks this step's fields (form.check over them) and says whether they are right; the wizard does not advance until it does. */
  check?: () => boolean | Promise<boolean>;
}

export interface WizardProps {
  /** The steps, in order. */
  steps: WizardStep[];
  /** The last step's button: Verb Noun naming the result (Publish Vacancy). */
  finish: string;
  /** Saving: the last button ignores presses but stays reachable. */
  busy?: boolean;
  /** Called after the last step checks clean. */
  onFinish: () => void;
  /** Cancel, shown on the first step instead of Back. */
  onCancel?: () => void;
  /** The step to start on (a draft resumed); 0. */
  initialStep?: number;
  /** Called with the step index each time it changes, so a draft can remember it. */
  onStepChange?: (index: number) => void;
}

export function Wizard({ steps, finish, busy, onFinish, onCancel, initialStep = 0, onStepChange }: WizardProps) {
  const [at, setAt] = useState(Math.min(Math.max(initialStep, 0), steps.length - 1));
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const step = steps[at];
  const last = at === steps.length - 1;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
    onStepChange?.(at);
  }, [at, onStepChange]);

  if (!step) return null;

  const next = async () => {
    if (step.check && !(await step.check())) return;
    if (last) onFinish();
    else setAt(at + 1);
  };

  return (
    <div>
      <ol className="mb-4 flex gap-1.5" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.title} aria-current={i === at ? "step" : undefined} className={cn("h-1 flex-1 rounded-full", i <= at ? "bg-secondary" : "bg-border")}>
            <span className="sr-only">
              Step {i + 1} of {steps.length}: {s.title}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-1 text-2xs font-semibold text-subtle-foreground uppercase">
        Step {at + 1} of {steps.length}
      </p>
      <h3 ref={heading} tabIndex={-1} data-ui="title" className="mb-3 text-lg font-semibold outline-none">
        {step.title}
      </h3>
      <div>{step.body}</div>
      <FormFooter>
        {at > 0 ? (
          <Button onClick={() => setAt(at - 1)}>Back</Button>
        ) : (
          onCancel && <Button onClick={onCancel}>Cancel</Button>
        )}
        <Button variant="primary" busy={last && busy} onClick={() => void next()}>
          {last ? finish : "Next"}
        </Button>
      </FormFooter>
    </div>
  );
}
