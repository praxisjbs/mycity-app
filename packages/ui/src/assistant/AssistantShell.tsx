/**
 * @component AssistantShell
 * @group Assistant
 * @summary The full-screen Praxis AI: Back to the screen it was opened from, the title and its actions, the conversation beside the pane on desktop (about two fifths and three fifths), the conversation alone on a phone.
 * @use Once, as the Ask screen's frame (docs/guides/praxis-ai.md decision 12, 13): the screen passes the conversation, the pane (PaneTabs) and, behind a toggle, Recent as the aside. Escape goes Back like the button.
 * @avoid Any other screen; a chat over the screen on a phone (PhonePage); a list beside its record (SplitPanes, ListDetail).
 * @phone The conversation fills the page, the box at its foot; no pane (an answer's Open Figures opens PaneSheet); Back is a 44 px target and the subtitle is left off.
 * @a11y One h1 (the page title); Back is a named button, and Escape does the same outside an open overlay; the conversation and the pane are named regions.
 * @status beta
 * @example <AssistantShell title="Praxis AI" back={{ to: "People · Leave", onBack }} actions={<Button icon="plus">New Conversation</Button>} conversation={log} pane={<PaneTabs ... />} />
 */
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { ActionGroup } from "../actions/ActionGroup";
import { Button } from "../actions/Button";

export interface AssistantShellProps {
  /** The page's name, at most 3 words: the assistant's name from the shell's catalogue. */
  title: ReactNode;
  /** Where Back goes: the screen's name in words (People · Leave), and the press. Without it there is no Back. */
  back?: { to: string; onBack: () => void } | null;
  /** The header's actions: New Conversation, the Recent toggle. */
  actions?: ReactNode;
  /** The conversation: the log and the box, a column that fills. */
  conversation: ReactNode;
  /** The right pane (PaneTabs); desktop only. */
  pane?: ReactNode;
  /** Recent, as a narrow column before the conversation while `asideOpen`; desktop only. */
  aside?: ReactNode;
  /** Whether the aside is showing. */
  asideOpen?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

const PANEL = "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card";

export function AssistantShell({ title, back, actions, conversation, pane, aside, asideOpen, className }: AssistantShellProps) {
  const goBack = useRef(back?.onBack);
  goBack.current = back?.onBack;
  // Escape goes Back, as the button does, unless an open overlay took it first (Radix prevents its default).
  useEffect(() => {
    if (!back) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      goBack.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [back]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2 phone:mb-2">
        {back && (
          <Button variant="ghost" icon="left" onClick={back.onBack}>
            Back
          </Button>
        )}
        <div className="min-w-0">
          <h1 data-ui="page-title" className="text-2xl phone:text-xl">
            {title}
          </h1>
          {back && (
            <p data-ui="page-subtitle" className="text-xs text-muted-foreground phone:hidden">
              From {back.to}
            </p>
          )}
        </div>
        {actions != null && (
          <div className="ml-auto flex items-center gap-1.5">
            <ActionGroup>{actions}</ActionGroup>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {asideOpen && aside != null && (
          <aside aria-label="Recent" className={cn(PANEL, "hidden w-64 flex-none desk:flex")}>
            {aside}
          </aside>
        )}
        <section aria-label="Conversation" className={cn(PANEL, "flex flex-1 desk:flex-none desk:basis-2/5")}>
          {conversation}
        </section>
        {pane != null && (
          <section aria-label="Pane" className={cn(PANEL, "hidden flex-1 desk:flex")}>
            {pane}
          </section>
        )}
      </div>
    </div>
  );
}
