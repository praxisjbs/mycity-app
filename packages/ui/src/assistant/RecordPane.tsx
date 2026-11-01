/**
 * @component RecordPane
 * @group Assistant
 * @summary The pane's Record: the record behind a chip or a table row, its fields as the person may see them, and Open Record to its own screen.
 * @use In PaneTabs' record slot, filled when a SourceChip names one record or a TablePane row is pressed; the cells are the read's own, already masked for the person (docs/guides/praxis-ai.md decision 13).
 * @avoid A record's full screen (its own tab and `id`); an edit form; a 360.
 * @phone The same fields stacked, label above value, inside the pane sheet; Open Record full width at the foot.
 * @a11y The title is a heading of the pane; the fields are a description list; Open Record is a button that says where it goes.
 * @status beta
 * @example <RecordPane record={{ title: "Ayo Bello", items: [["Days", "3"]], link: "/people?tab=leave&id=l1" }} onOpen={navigate} />
 */
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";
import { EmptyState } from "../display/EmptyState";
import { KeyValue } from "../display/KeyValue";
import type { PaneRecord } from "./pane";

export interface RecordPaneProps {
  /** The record in view, or null before a chip or a row picked one. */
  record: PaneRecord | null;
  /** Opens the record's own screen, by its path. */
  onOpen?: (link: string) => void;
  /** Layout classes only (spacing). */
  className?: string;
}

export function RecordPane({ record, onOpen, className }: RecordPaneProps) {
  if (!record) return <EmptyState bare title="No Record Open" className={className} />;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <h3 data-copy="content" className="text-base font-strong">
        {record.title}
      </h3>
      <KeyValue layout="stacked" items={record.items.map(([label, value]) => [<span key={label} data-copy="content">{label}</span>, value])} />
      {record.link && onOpen && (
        <div className="phone:mt-auto">
          <Button iconRight="right" onClick={() => onOpen(record.link!)} className="phone:w-full">
            Open Record
          </Button>
        </div>
      )}
    </div>
  );
}
