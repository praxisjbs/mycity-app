/**
 * @component StageSwitcher
 * @group Navigation
 * @summary A deal's stage as a bar of the few steps its stages count as, the exact stage named, with Next Stage and Change Stage.
 * @use A record that moves through a long list of stages: a partnership deal on its 360 (docs/guides/partnerships.md §6.5, §10). The bar shows how far it has come; Next Stage is the usual move in one press; Change Stage lists every stage for the rarer ones. The screen asks for a reason, or the signed copy, after the press when the move needs one.
 * @avoid Filtering a list by stage (use Chips or FilterSelect); a board of cards in columns (use Kanban); steps of a form (use Wizard or StepBar).
 * @phone The bar keeps its width with only the current step named under it; Change Stage and Next Stage stack full width, 44 px each, Change Stage opening as an action sheet.
 * @a11y A region named by `label`; the bar is a list whose current step is aria-current="step"; Next Stage is named "Move to Proposal Sent"; the current stage in Change Stage is shown and not choosable. While a move runs Next Stage says aria-busy and Change Stage waits.
 * @status beta
 * @example <StageSwitcher steps={steps} stages={stages} value={deal.stage} next="proposal_sent" onMove={(code) => move(code)} />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Button } from "../actions/Button";
import { ActionGroup } from "../actions/ActionGroup";
import { Menu, type MenuItem } from "../overlay/Menu";

/** One step of the bar: what a stage counts as (Prospect, Negotiation, Signed). */
export interface StageStep {
  code: string;
  label: string;
}

/** One stage, in order: its code, its label and the step it counts as (none for On Hold or Closed Lost). */
export interface StageOption {
  code: string;
  label: string;
  step?: string | null;
}

export interface StageSwitcherProps {
  /** The bar's steps, in order. */
  steps: readonly StageStep[];
  /** Every stage the record may move to, in order (retired stages left out, the current one kept): Change Stage lists them. */
  stages: readonly StageOption[];
  /** The code of the stage the record is at. */
  value: string;
  /** The stage Next Stage moves to; none hides the button (the last stage, On Hold, Closed Lost). */
  next?: string | null;
  /** One move: hand back the work (a promise) so Next Stage spins and Change Stage waits until it settles (F26). */
  onMove: (code: string) => unknown;
  /** Names the region for assistive technology ("Stage of Drive-Time Features"). */
  label?: string;
  /** The record is read only (a converted lead): the bar and the stage show, nothing moves. */
  readOnly?: boolean;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

export function StageSwitcher({ steps, stages, value, next, onMove, label = "Stage", readOnly, className }: StageSwitcherProps) {
  const current = stages.find((s) => s.code === value);
  const at = current?.step ? steps.findIndex((s) => s.code === current.step) : -1;
  const following = next ? stages.find((s) => s.code === next) : undefined;
  const items: MenuItem[] = stages.map((s) => ({
    label: s.label,
    icon: s.code === value ? "tick" : undefined,
    disabled: s.code === value,
    onSelect: () => onMove(s.code),
  }));

  return (
    <section aria-label={label} className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 phone:flex-col phone:items-stretch">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Stage</p>
          <p className="text-base font-semibold text-foreground" data-copy="content">
            {current?.label ?? value}
          </p>
          {following && !readOnly && (
            <p className="text-xs text-muted-foreground" data-copy="content">
              Next: {following.label}
            </p>
          )}
        </div>
        {!readOnly && (
          <ActionGroup>
            <div className="flex flex-wrap items-center gap-2 phone:flex-col phone:items-stretch">
              <Menu
                label="Change Stage"
                align="end"
                trigger={(t) => (
                  <Button {...t} iconRight="down">
                    Change Stage
                  </Button>
                )}
                items={items}
              />
              {following && (
                <Button variant="primary" icon="forward" aria-label={`Move to ${following.label}`} onClick={() => onMove(following.code)}>
                  Next Stage
                </Button>
              )}
            </div>
          </ActionGroup>
        )}
      </div>
      <ol className="flex gap-1.5">
        {steps.map((s, i) => {
          const state = i === at ? "current" : at >= 0 && i < at ? "done" : "ahead";
          return (
            <li key={s.code} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span aria-hidden="true" className={cn("h-1.5 w-full rounded-full", state === "done" && "bg-success", state === "current" && "bg-secondary", state === "ahead" && "bg-border")} />
              <span className={cn("flex items-center gap-1 truncate text-xs", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground", state !== "current" && "phone:sr-only")}>
                {state === "done" && <Icon name="tick" size="s" />}
                <span className="truncate">{s.label}</span>
                <span className="sr-only">{state === "done" ? ", done" : state === "current" ? ", current step" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
