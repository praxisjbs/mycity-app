/**
 * @component HireSteps
 * @group Display
 * @summary How a role is filled, in numbered steps: a row of four circles on a dashed line, the first in yellow, each with its title and a line, rising in turn; `compact` is a row of small numbered tiles for a role's own page.
 * @use The index's How We Hire (the four steps with a line each) and a vacancy's How We Hire part (compact, the stages that role uses).
 * @avoid A form's own steps (Wizard, StepBar); a record's history (Timeline); a sequence a person moves through on the screen.
 * @phone Two to a row from 1040 px down without the dashed line, one to a row on a phone.
 * @a11y An ordered list named by `label`, so the order is heard; each step's number is drawn and its title is an h3 in the full form. Under reduced motion the steps simply show.
 * @status beta
 * @example <HireSteps label="How We Hire" steps={[{ title: "Apply", text: "Your CV and a short cover letter, on one form." }, { title: "Screening", text: "Our team reads every application against the role." }]} />
 * @example <HireSteps compact label="How We Hire" steps={[{ title: "Apply" }, { title: "Screening" }, { title: "Interview" }]} />
 */
import { cn } from "../lib/cn";
import { Reveal } from "../layout/Reveal";

export interface HireStep {
  /** The step's name, Title Case, at most 4 words (Screening). */
  title: string;
  /** One line under it, in the full form. */
  text?: string;
}

export interface HireStepsProps {
  /** The steps, in the order a candidate meets them. */
  steps: ReadonlyArray<HireStep>;
  /** Names the list (How We Hire). */
  label: string;
  /** Small numbered tiles in a row, for a role's own page. */
  compact?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function HireSteps({ steps, label, compact, className }: HireStepsProps) {
  if (compact)
    return (
      <ol className={cn("ps-hsteps", className)} aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <b aria-hidden="true">{i + 1}</b>
            {s.title}
          </li>
        ))}
      </ol>
    );
  return (
    <ol className={cn("ps-steps", className)} aria-label={label}>
      {steps.map((s, i) => (
        <Reveal key={s.title} as="li" delay={i * 120} className="ps-step">
          <span aria-hidden="true" className="ps-step-n">
            {i + 1}
          </span>
          <h3 data-ui="title">{s.title}</h3>
          {s.text && <p>{s.text}</p>}
        </Reveal>
      ))}
    </ol>
  );
}
