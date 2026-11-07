/**
 * @component StageSwitcher
 * @group Navigation
 * @summary A deal's stages in order, the current one marked; one press on another stage moves the deal there.
 * @use A record that moves through a list of stages one press at a time: a partnership deal on its 360 (docs/guides/partnerships.md §6.5). The screen asks for a reason, or the signed copy, after the press when the move needs one.
 * @avoid Filtering a list by stage (use Chips or FilterSelect); a board of cards in columns (use Kanban); steps of a form (use Wizard or StepBar).
 * @phone One row that scrolls sideways inside itself, the current stage brought into view; each stage is a 44 px target. The screen puts the next stage full width at the foot of the record.
 * @a11y A group named by `label`; each stage is a button, the current one aria-current="step" and refused, the others named "Move to Proposal Sent". Left and Right move between stages. While a move runs its button says aria-busy and the others aria-disabled.
 * @status beta
 * @example <StageSwitcher label="Stage" stages={stages} value={deal.stage} onMove={(code) => move(code)} />
 */
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import { PressGroupContext, pressState, usePress, usePressGroup } from "../actions/press";

/** One stage of the list, in order: its code and label (a stage's meaning stays the screen's). */
export interface StageOption {
  code: string;
  label: string;
}

export interface StageSwitcherProps {
  /** The stages in order, the ones a deal may move to (retired stages left out, the current one kept). */
  stages: readonly StageOption[];
  /** The code of the stage the record is at. */
  value: string;
  /** One press on another stage: hand back the work (a promise) so the stage spins and the others wait until it settles (F26). */
  onMove: (code: string) => unknown;
  /** Names the group for assistive technology ("Stage"). */
  label?: string;
  /** The record is read only (a converted lead): the stages show, none can be pressed. */
  readOnly?: boolean;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** One stage: done (before the current), current, or ahead. */
function Step({ stage, state, onMove, readOnly, focusRef }: { stage: StageOption; state: "done" | "current" | "ahead"; onMove: (code: string) => unknown; readOnly?: boolean; focusRef?: (node: HTMLButtonElement | null) => void }) {
  const own = useRef<HTMLButtonElement | null>(null);
  const current = state === "current";
  const { busy, waiting, press } = usePress<MouseEvent<HTMLButtonElement>>(current || readOnly ? undefined : () => onMove(stage.code), undefined, own);
  return (
    <button
      ref={(node) => {
        own.current = node;
        focusRef?.(node);
      }}
      type="button"
      data-ui="button"
      data-stage={stage.code}
      data-press={pressState({ busy, waiting })}
      aria-current={current ? "step" : undefined}
      aria-label={current ? `${stage.label}, current stage` : `Move to ${stage.label}`}
      aria-busy={busy || undefined}
      aria-disabled={current || readOnly || waiting || undefined}
      onClick={press}
      className={cn(
        "inline-flex h-8 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-(--dur-fast) phone:min-h-tap phone:min-w-tap phone:justify-center",
        current && "border-secondary bg-secondary text-secondary-foreground",
        state === "done" && "border-success-soft bg-success-soft text-foreground",
        state === "ahead" && "border-border bg-card text-muted-foreground",
        !current && !readOnly && "hover:border-subtle-foreground hover:text-foreground",
        (waiting || readOnly) && !current && "opacity-60",
      )}
    >
      {busy ? <Spinner size="s" label="Moving" /> : state === "done" ? <Icon name="tick" size="s" /> : null}
      {stage.label}
    </button>
  );
}

export function StageSwitcher({ stages, value, onMove, label = "Stage", readOnly, className }: StageSwitcherProps) {
  const group = usePressGroup();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const index = stages.findIndex((s) => s.code === value);

  // Bring the current stage into view in the row that scrolls on a phone.
  useEffect(() => {
    const node = buttons.current[index];
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const at = buttons.current.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const next = buttons.current[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <PressGroupContext.Provider value={group}>
      <div role="group" aria-label={label} onKeyDown={onKeyDown} className={cn("no-scrollbar flex max-w-full gap-1.5 overflow-x-auto desk:flex-wrap", className)}>
        {stages.map((stage, i) => (
          <Step
            key={stage.code}
            stage={stage}
            state={i === index ? "current" : index >= 0 && i < index ? "done" : "ahead"}
            onMove={onMove}
            readOnly={readOnly}
            focusRef={(node) => {
              buttons.current[i] = node;
            }}
          />
        ))}
      </div>
    </PressGroupContext.Provider>
  );
}
