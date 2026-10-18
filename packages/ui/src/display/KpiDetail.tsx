/**
 * @component KpiDetail
 * @group Display
 * @summary The report model behind a KPI card: the records that make up the number, grouped, searchable and paged at 25.
 * @use As the body of the modal a KPI card opens (docs/guides/home.md §3 step 3), and anywhere a figure has to be opened up.
 * @avoid Explaining how the figure is worked out (that is the guide's); loading the whole set to count it; a second table inside it.
 * @phone The modal is a bottom sheet and the records are cards, so the groups stay chips and nothing scrolls sideways.
 * @a11y The group chips are a group named for the list, each chip saying whether it is pressed; the summary is a live region, so a changed group is heard.
 * @status stable
 * @example <KpiDetail summary="22 of 25 clocked in" groups={groups} group={group} onGroup={setGroup} list={list} columns={columns} rowKey={(r) => r.id} />
 */
import { useEffect, useState, type ReactNode } from "react";
import { Chips } from "../navigation/Chips";
import { SearchInput } from "../form/SearchInput";
import { DataView, type DataViewColumn, type DataViewList } from "../data/DataView";

/** One way the records are grouped (On Site, Remote, Late), with how many are in it. */
export interface KpiDetailGroup {
  /** The value sent to the server as the group filter. */
  value: string;
  /** Its name, Title Case, at most 3 words. */
  label: string;
  /** How many records are in it, from the server. */
  count: number;
}

export interface KpiDetailProps<R> {
  /** One operational line above the list, at most 20 words ("22 of 25 clocked in across the organisation"). */
  summary?: ReactNode;
  /** The groups the rules read the figure in; chips show only when there is more than one. All counts the whole list, not their sum, since groups can overlap. */
  groups?: KpiDetailGroup[];
  /** The group in view; `all` for every record. */
  group?: string;
  /** Called with the chosen group's value, or `all`. */
  onGroup?: (group: string) => void;
  /** The server-paged records behind the number (a `usePaged()` result). */
  list: DataViewList<R>;
  /** The columns, as the KPI's own meta describes them. */
  columns: DataViewColumn<R>[];
  /** Names one record. */
  rowKey: (row: R) => string;
  /** Opens a record; the modal closes first, so the person lands on the screen. */
  onRowClick?: (row: R) => void;
  /** What one record is, for the pager's count ("person"). */
  noun?: string;
  /** The plural, when it is not the noun with an s. */
  nounPlural?: string;
  /** Names the list for screen readers; the KPI's own title. */
  caption: string;
  /** What to show when nothing is behind the number. */
  empty?: { title: ReactNode; text?: ReactNode };
}

/** Rows a list needs before its search box is worth the space. */
const SEARCH_FROM = 8;

export function KpiDetail<R>({ summary, groups, group = "all", onGroup, list, columns, rowKey, onRowClick, noun, nounPlural, caption, empty }: KpiDetailProps<R>) {
  /*
   * All counts every record behind the number: the server's total for the whole list, read
   * once its first answer with no group and no search has come back. The groups are not
   * added up for it, because they can overlap (someone late today can also have no
   * clock-out from yesterday); until that answer, their sum stands in.
   */
  const whole = group === "all" && !list.q && !list.loading ? list.page?.total : undefined;
  const [wholeTotal, setWholeTotal] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (whole !== undefined) setWholeTotal((known) => known ?? whole);
  }, [whole]);
  const total = wholeTotal ?? (groups ?? []).reduce((sum, g) => sum + g.count, 0);
  const setQ = list.setQ;
  // Searching three rows is noise; the box appears once the list is longer than a screenful.
  const searchable = (list.page?.total ?? 0) > SEARCH_FROM && setQ !== undefined;

  return (
    <>
      {summary != null && (
        <p aria-live="polite" className="mb-3 text-xs text-muted-foreground">
          {summary}
        </p>
      )}
      {groups && groups.length > 1 && onGroup && (
        <Chips
          label={caption}
          value={group}
          onChange={onGroup}
          options={[{ value: "all", label: "All", count: total }, ...groups.map((g) => ({ value: g.value, label: g.label, count: g.count }))]}
          className="mb-3"
        />
      )}
      {searchable && setQ && <SearchInput value={list.q ?? ""} onChange={setQ} placeholder="Search List" className="mb-3" />}
      <DataView bare list={list} columns={columns} rowKey={rowKey} onRowClick={onRowClick} caption={caption} noun={noun} nounPlural={nounPlural} empty={empty ?? { title: "Nothing Behind This" }} />
    </>
  );
}
