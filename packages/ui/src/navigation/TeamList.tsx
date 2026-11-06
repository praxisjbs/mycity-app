/**
 * @component TeamList
 * @group Navigation
 * @summary The teams hiring, one picked at a time, each with how many roles it has: a column of rows on desktop (the one picked in Deep Green with a yellow count), a row of pills that scrolls sideways inside itself below 1041 px.
 * @use The careers list's aside (All Teams, then each department hiring), narrowing the server's list to one department.
 * @avoid More than one pick at a time (use Chips); a list's own toolbar (FilterSelect); the staff app.
 * @phone The pills scroll sideways within their row, never the page; each is a 44 px target.
 * @a11y A list named by `label` of toggle buttons (aria-pressed), each named by its team and its count; the team names are content.
 * @status beta
 * @example <TeamList title="Teams" titleId="roles-title" label="Teams" note={recommend} value={code} onChange={setCode} items={teams} />
 * @example <TeamList label="Teams" value={code} onChange={setCode} items={[{ value: "", label: "All Teams", count: 12 }, { value: "MKT", label: "Marketing & Sales", count: 4 }]} />
 */
import type { ReactNode } from "react";
import { content } from "../lib/slots";

export interface TeamListItem {
  /** What onChange is called with (a department's code; "" for All Teams). */
  value: string;
  /** The team's name. */
  label: string;
  /** How many roles it has. */
  count: number;
}

export interface TeamListProps {
  /** Names the list (Teams). */
  label: string;
  /** All Teams first, then each team. */
  items: ReadonlyArray<TeamListItem>;
  /** The value picked. */
  value: string;
  /** Called with the value pressed. */
  onChange: (value: string) => void;
  /** A heading over the list, in spaced capitals (Teams); its id names the section it heads. */
  title?: string;
  /** The heading's id. */
  titleId?: string;
  /** A line under the list, over a hairline (Know someone for one of these? Recommend them); left off from 1040 px down. */
  note?: ReactNode;
}

export function TeamList({ label, items, value, onChange, title, titleId, note }: TeamListProps) {
  const list = (
    <ul className="ps-teams" aria-label={label}>
      {items.map((t) => (
        <li key={t.value || "all"}>
          <button type="button" className="ps-team" aria-pressed={t.value === value} onClick={() => onChange(t.value)}>
            <span {...content}>{t.label}</span> <small>{t.count}</small>
          </button>
        </li>
      ))}
    </ul>
  );
  if (title == null && note == null) return list;
  return (
    <div>
      {title != null && (
        <h2 id={titleId} data-ui="title" className="ps-eyebrow m-0">
          {title}
        </h2>
      )}
      {list}
      {note != null && <p className="ps-side-note">{note}</p>}
    </div>
  );
}
