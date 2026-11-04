/**
 * @component PaneTabs
 * @group Assistant
 * @summary The pane's four views, Overview, Table, Record and Sources, as tabs; a view with nothing to show stays, disabled, so the layout never jumps.
 * @use Inside AssistantShell's pane on desktop and inside PaneSheet on a phone, with each view's component in its slot (docs/guides/praxis-ai.md decision 13).
 * @avoid A module's tab strip (the shell's Tabs); views that are not these four; hiding an empty tab.
 * @phone The same four tabs, scrolling sideways if they must, inside the sheet; each is a 44 px target.
 * @a11y A Radix tab list named Pane; a disabled tab is still read, so a person knows the view exists; the shown panel is the active tab's.
 * @status beta
 * @example <PaneTabs value={tab} onValueChange={setTab} table={<TablePane {...rows} />} sources={<SourcesPane reads={reads} />} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Tabs, TabPanel } from "../navigation/Tabs";
import { PANE_TABS, type PaneTab } from "./pane";

export interface PaneTabsProps {
  /** The tab in view; a disabled one falls back to the first that has something to show. */
  value: PaneTab;
  /** Called with the tab pressed. */
  onValueChange: (tab: PaneTab) => void;
  /** The Overview's view (OverviewPane); nothing disables its tab. */
  overview?: ReactNode;
  /** The Table's view (TablePane); nothing disables its tab. */
  table?: ReactNode;
  /** The Record's view (RecordPane); nothing disables its tab. */
  record?: ReactNode;
  /** The Sources' view (SourcesPane); nothing disables its tab. */
  sources?: ReactNode;
  /** Names the strip for assistive technology; Pane unless set. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

const has = (node: ReactNode) => node != null && node !== false;

export function PaneTabs({ value, onValueChange, overview, table, record, sources, label = "Pane", className }: PaneTabsProps) {
  const views: Record<PaneTab, ReactNode> = { overview, table, record, sources };
  const available = PANE_TABS.filter((t) => has(views[t.value])).map((t) => t.value);
  const shown = available.includes(value) ? value : available[0];
  return (
    <Tabs
      label={label}
      value={shown ?? value}
      onValueChange={(v) => onValueChange(v as PaneTab)}
      items={PANE_TABS.map((t) => ({ value: t.value, label: t.label, disabled: !available.includes(t.value) }))}
      className={cn("flex min-h-0 flex-1 flex-col [&>div:first-child]:flex-none [&>div:first-child]:px-2", className)}
    >
      {PANE_TABS.map((t) => (
        <TabPanel key={t.value} value={t.value} className="min-h-0 flex-1 overflow-y-auto p-3.5 pt-3 data-[state=inactive]:hidden">
          {views[t.value]}
        </TabPanel>
      ))}
    </Tabs>
  );
}
