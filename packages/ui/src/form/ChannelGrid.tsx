/**
 * @component ChannelGrid
 * @group Forms
 * @summary Switches in a grid: one row per kind of thing (a notification category), one column per way it reaches a person (In App, Email, Push); each switch saves on its own.
 * @use Notification Settings: where each category reaches the person. Any per-row, per-channel on and off choice that saves at once.
 * @avoid A form with a Save button (CheckboxField in a Form); one setting (Switch or ToggleRow); more than four columns.
 * @phone One row per category with what is on ("In App, Push", or Off); a tap opens a sheet titled by the category with a ToggleRow per channel.
 * @a11y Desktop is a table: the columns are headers and each switch is named "<row>, <column>". A locked switch is disabled and says why with the lock's label. On a phone each row is a button that opens the sheet.
 * @status beta
 * @example <ChannelGrid columns={[{ key: "in_app", label: "In App" }, { key: "push", label: "Push" }]} rows={rows} onChange={(row, column, on) => save(row, column, on)} />
 */
import { useState } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { Switch, ToggleRow } from "./Switch";

export interface ChannelGridColumn {
  key: string;
  /** Title Case, at most 2 words. */
  label: string;
}

export interface ChannelGridRow {
  key: string;
  /** Title Case, at most 4 words. */
  label: string;
  /** Each column's state, by column key. */
  values: Record<string, boolean>;
  /** Columns that cannot be switched for this row (on and kept on), by column key. */
  locked?: Record<string, boolean>;
}

export interface ChannelGridProps {
  /** The ways a row can reach a person, left to right (In App, Email, Push). */
  columns: ChannelGridColumn[];
  /** One per category, in the order shown. */
  rows: ChannelGridRow[];
  /** Called with the new state of one switch. Hands back its work; the grid shows the new state at once. */
  onChange: (row: string, column: string, on: boolean) => unknown;
  /** What locked means, as the lock's label ("Always on"). */
  lockedLabel?: string;
  /** Names the grid for assistive technology. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

function summaryOf(row: ChannelGridRow, columns: ChannelGridColumn[]): string {
  const on = columns.filter((c) => row.values[c.key]).map((c) => c.label);
  return on.length ? on.join(", ") : "Off";
}

export function ChannelGrid({ columns, rows, onChange, lockedLabel = "Always on", label, className }: ChannelGridProps) {
  const phone = useIsPhone();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const current = rows.find((r) => r.key === openRow) ?? null;

  if (phone) {
    return (
      <div className={cn("divide-y divide-border", className)}>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => setOpenRow(row.key)}
            className="flex min-h-tap w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{row.label}</span>
              <span className="truncate text-xs text-subtle-foreground">{summaryOf(row, columns)}</span>
            </span>
            {row.locked && Object.values(row.locked).some(Boolean) && <Icon name="lock" size="s" className="flex-none text-subtle-foreground" />}
            <Icon name="right" size="s" className="flex-none text-subtle-foreground" />
          </button>
        ))}
        <Sheet open={!!current} onClose={() => setOpenRow(null)} title={current?.label ?? ""}>
          {current &&
            columns.map((c) => (
              <ToggleRow
                key={c.key}
                title={c.label}
                text={current.locked?.[c.key] ? lockedLabel : undefined}
                checked={!!current.values[c.key]}
                disabled={!!current.locked?.[c.key]}
                onChange={(on) => void onChange(current.key, c.key, on)}
              />
            ))}
        </Sheet>
      </div>
    );
  }

  return (
    <table aria-label={label} className={cn("w-full text-sm", className)}>
      <thead>
        <tr className="border-b border-border text-left text-xs text-subtle-foreground">
          <th scope="col" className="py-2 pr-3 font-semibold">
            <span className="sr-only">Category</span>
          </th>
          {columns.map((c) => (
            <th key={c.key} scope="col" className="w-24 px-2 py-2 text-center font-semibold">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border last:border-b-0">
            <th scope="row" className="py-2.5 pr-3 text-left font-normal">
              <span className="inline-flex items-center gap-1.5">
                {row.label}
                {row.locked && Object.values(row.locked).some(Boolean) && <Icon name="lock" size="s" label={lockedLabel} className="text-subtle-foreground" />}
              </span>
            </th>
            {columns.map((c) => (
              <td key={c.key} className="px-2 py-2.5 text-center">
                <Switch
                  label={`${row.label}, ${c.label}`}
                  checked={!!row.values[c.key]}
                  disabled={!!row.locked?.[c.key]}
                  onChange={(on) => void onChange(row.key, c.key, on)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
