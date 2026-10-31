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
import { Button } from "../actions/Button";
import { FormError } from "./Field";
import { FormFooter } from "./Form";
import { StepBar } from "./StepBar";

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
  /** Called after the last step checks clean. Return the save's promise and the last button spins until it settles. */
  onFinish: () => unknown;
  /** Cancel, shown on the first step instead of Back. */
  onCancel?: () => void;
  /** The step to start on (a draft resumed); 0. */
  initialStep?: number;
  /** Called with the step index each time it changes, so a draft can remember it. */
  onStepChange?: (index: number) => void;
  /**
   * The step in view, when the form decides it (a refusal on a field of step 1 takes the person
   * back there). Set it with `onStepChange`; left unset, the wizard keeps its own step.
   */
  step?: number;
  /** The one general error, above the footer: a refusal that names no field (FRONTEND_GUIDE §8.3). */
  error?: ReactNode;
}

export function Wizard({ steps, finish, busy, onFinish, onCancel, initialStep = 0, onStepChange, step: controlled, error }: WizardProps) {
  const clamp = (i: number) => Math.min(Math.max(i, 0), steps.length - 1);
  const [own, setOwn] = useState(clamp(initialStep));
  const at = controlled === undefined ? own : clamp(controlled);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(at);
  const step = steps[at];
  const last = at === steps.length - 1;

  // Focus moves to the heading only when the step itself changes: a parent re-rendering (a new
  // onStepChange on every render) must never pull focus out of the field being typed in.
  useEffect(() => {
    if (shown.current === at) return;
    shown.current = at;
    heading.current?.focus();
    if (controlled === undefined) onStepChange?.(at);
  }, [at, onStepChange, controlled]);

  if (!step) return null;

  const setAt = (i: number) => (controlled === undefined ? setOwn(i) : onStepChange?.(i));
  const next = async () => {
    if (step.check && !(await step.check())) return;
    if (last) return onFinish();
    setAt(at + 1);
  };

  return (
    <div>
      <StepBar steps={steps.map((s) => s.title)} at={at} />
      <h3 ref={heading} tabIndex={-1} data-ui="title" className="mb-3 text-lg font-semibold outline-none">
        {step.title}
      </h3>
      <div>{step.body}</div>
      {error ? <div className="mt-3"><FormError>{error}</FormError></div> : null}
      <FormFooter>
        {at > 0 ? (
          <Button onClick={() => setAt(at - 1)}>Back</Button>
        ) : (
          onCancel && <Button onClick={onCancel}>Cancel</Button>
        )}
        <Button variant="primary" busy={last && busy} onClick={next}>
          {last ? finish : "Next"}
        </Button>
      </FormFooter>
    </div>
  );
}
