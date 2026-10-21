/**
 * @component NavCapsule
 * @group Shell
 * @summary Back, forward and refresh in one capsule at the start of the desktop top bar: a click on the arrow refreshes in place and a 0.6 s hold reloads the app (the Hold Ring); hovering an arrow names where it goes; a held or right clicked arrow opens the trail.
 * @use Once, in TopBar's start slot after the rail toggle (F28, F29). `arrows` only while the app runs installed (useInstalled), where the window has no back or forward of its own; refresh always.
 * @avoid A phone (the page pulls to refresh, the system's Back goes back); a record's own way back to its list (a link); more buttons in the capsule.
 * @phone Never shown on a phone; its buttons are 44 px targets so the gallery's phone view passes.
 * @a11y A group named History of three named buttons, each described by where it goes or what a hold does, aria-disabled with nothing back or ahead. An arrow opens the trail with a hold, a right click, Arrow Down or the menu key; Shift and Enter on Refresh reloads. Refresh is busy (aria-busy) until the screen's reads are in.
 * @status stable
 * @example <NavCapsule arrows={installed} back="People · Employees" onBack={back} onRefresh={refresh} onReload={reload} trail={trail} onGo={go} />
 */
import { forwardRef, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useHold } from "../lib/hold";
import { Icon, type IconName } from "../icons/Icon";
import { Tooltip } from "../overlay/Tooltip";
import { pressState, usePress } from "../actions/press";
import { TrailMenu, type TrailItem } from "./TrailMenu";

export interface NavCapsuleProps {
  /** Back and forward. False in a browser tab, which has its own (F29). Default true. */
  arrows?: boolean;
  /** Where Back goes, by name; null or absent when there is nowhere back. */
  back?: string | null;
  /** Where Forward goes, by name; null or absent when nothing is ahead. */
  forward?: string | null;
  /** Back one place. */
  onBack?: () => void;
  /** Forward one place. */
  onForward?: () => void;
  /** Refresh in place: the arrow turns until its promise settles, and a second press waits. */
  onRefresh: () => Promise<unknown>;
  /** The hold: restart the app. A promise it returns settles only if the page stays. */
  onReload: () => unknown;
  /** The trail, for the menu an arrow opens: the one ahead first, the place on screen, then back. */
  trail?: TrailItem[];
  /** Go to a place on the trail, by its offset. */
  onGo?: (offset: number) => void;
  /** The trail held open from elsewhere (the pin held); leave unset to let the capsule keep its own. */
  trailOpen?: boolean;
  /** Called when the trail opens or closes. */
  onTrailOpenChange?: (open: boolean) => void;
  /** Where the trail mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

const BUTTON =
  "relative inline-flex size-8 flex-none items-center justify-center rounded-full text-foreground outline-none transition-colors duration-(--dur-fast) hover:bg-background focus-visible:ring-2 focus-visible:ring-ring phone:size-tap aria-disabled:text-subtle-foreground aria-disabled:hover:bg-transparent";

/** Two lines in a tooltip: the button's name, and where it goes or what a hold does. */
const tip = (name: string, more?: ReactNode) => (
  <span className="flex flex-col">
    <span>{name}</span>
    {more ? <span className="text-2xs opacity-80">{more}</span> : null}
  </span>
);

interface ArrowProps {
  icon: IconName;
  name: string;
  to: string | null | undefined;
  onGo?: () => void;
  onTrail: () => void;
}

const Arrow = forwardRef<HTMLButtonElement, ArrowProps>(function Arrow({ icon, name, to, onGo, onTrail }, ref) {
  const hold = useHold({ onHold: onTrail, ms: 450 });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    onTrail();
  };
  return (
    <Tooltip label={tip(name, to ? <span data-copy="content">{to}</span> : undefined)}>
      <button
        ref={ref}
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-disabled={!to || undefined}
        data-ui="button"
        onClick={() => {
          if (to) onGo?.();
        }}
        onKeyDown={onKeyDown}
        {...hold}
        className={cn(BUTTON, "no-callout select-none")}
      >
        <Icon name={icon} size="m" />
      </button>
    </Tooltip>
  );
});

function Refresh({ onRefresh, onReload }: Pick<NavCapsuleProps, "onRefresh" | "onReload">) {
  const el = useRef<HTMLButtonElement>(null);
  const { busy, waiting, press } = usePress(() => onRefresh(), undefined, el);
  const [holding, setHolding] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reload = () => {
    setHolding(false);
    setReloading(true);
    void Promise.resolve(onReload()).finally(() => setReloading(false));
  };
  // The ring starts after a short press would have ended, so a click never flashes it.
  const hold = useHold({ onHold: reload, ms: 760, showAfter: 160, onHoldStart: () => setHolding(true), onHoldCancel: () => setHolding(false) });
  const spinning = busy || reloading;
  return (
    <Tooltip label={tip("Refresh", "Hold to Reload")}>
      <button
        ref={el}
        type="button"
        aria-label="Refresh"
        aria-keyshortcuts="Shift+Enter"
        aria-busy={spinning || undefined}
        aria-disabled={spinning || waiting || undefined}
        data-ui="button"
        data-press={pressState({ busy: spinning, waiting })}
        data-holding={holding || undefined}
        onClick={press}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            reload();
          }
        }}
        {...hold}
        className={cn(BUTTON, "no-callout select-none data-[press=busy]:cursor-progress")}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full -rotate-90">
          <circle cx="16" cy="16" r="14.5" pathLength={100} strokeWidth={2.5} strokeLinecap="round" className="hold-ring fill-none stroke-primary" />
        </svg>
        <Icon name="rotate" size="m" className={cn(spinning && "animate-spin")} />
      </button>
    </Tooltip>
  );
}

export function NavCapsule({ arrows = true, back, forward, onBack, onForward, onRefresh, onReload, trail = [], onGo, trailOpen, onTrailOpenChange, container }: NavCapsuleProps) {
  const [own, setOwn] = useState(false);
  const open = trailOpen ?? own;
  const setOpen = (next: boolean) => {
    if (trailOpen === undefined) setOwn(next);
    onTrailOpenChange?.(next);
  };
  const showTrail = () => {
    if (trail.length > 1) setOpen(true);
  };
  const capsule = (
    <div role="group" aria-label="History" className="inline-flex flex-none items-center gap-px rounded-full border border-border bg-muted p-0.5">
      {arrows && (
        <>
          <Arrow icon="left" name="Back" to={back} onGo={onBack} onTrail={showTrail} />
          <Arrow icon="right" name="Forward" to={forward} onGo={onForward} onTrail={showTrail} />
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
        </>
      )}
      <Refresh onRefresh={onRefresh} onReload={onReload} />
    </div>
  );
  if (!arrows) return capsule;
  return (
    <TrailMenu open={open} onOpenChange={setOpen} items={trail} onGo={(offset) => onGo?.(offset)} container={container}>
      {capsule}
    </TrailMenu>
  );
}
