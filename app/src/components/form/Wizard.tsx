import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { FormFooter } from "./Footer";

/**
 * A form of more than six fields or more than one topic (§8.1): one topic per
 * step, a step indicator, Back and Next. A step does not advance until its
 * fields are right (`check` marks them, as Submit does, §8.3). The last step's
 * button names the result ("Add Employee").
 *
 *   <Wizard
 *     steps={[{ title: "Person", body: ..., check: () => f.check(["first_name", "email"]) }, ...]}
 *     finish="Add Employee" busy={save.pending} onFinish={submit} onCancel={close}
 *   />
 */
export interface WizardStep {
  title: string;
  body: ReactNode;
  /** Marks this step's fields and says whether they are right. */
  check?: () => boolean;
}

export function Wizard({ steps, finish, busy, onFinish, onCancel }: { steps: WizardStep[]; finish: string; busy?: boolean; onFinish: () => void; onCancel: () => void }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  const next = () => {
    if (step.check && !step.check()) return;
    if (last) onFinish();
    else setI(i + 1);
  };
  return (
    <>
      <ol className="mb-4 flex gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`}>
        {steps.map((s, n) => (
          <li key={s.title} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn("h-1 rounded-full", n <= i ? "bg-secondary" : "bg-border")} />
            <span className={cn("truncate text-[11px] font-semibold", n === i ? "text-foreground" : "text-subtle-foreground")} aria-current={n === i ? "step" : undefined}>
              {s.title}
            </span>
          </li>
        ))}
      </ol>
      {step.body}
      <FormFooter>
        {i === 0 ? <Button onClick={onCancel}>Cancel</Button> : <Button onClick={() => setI(i - 1)}>Back</Button>}
        <Button variant="primary" busy={busy} onClick={next}>
          {last ? finish : "Next"}
        </Button>
      </FormFooter>
    </>
  );
}
