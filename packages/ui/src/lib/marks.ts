import { createContext, useContext } from "react";

/**
 * Rows a list marks as new to its reader, because something unread is about them (the hub's
 * notifications, docs/guides/notifications.md §6). The app gives it once, over every screen, as
 * `RowMarksContext`; `DataView` asks it which of its rows to mark and tells it when a marked row is
 * opened. Without a provider (the gallery, a test, the public site) nothing is marked.
 */
export interface RowMarks {
  /** Which of these row keys to mark. A hook: every list calls it once on each render, with its page's keys. */
  useMarked: (keys: readonly string[]) => ReadonlySet<string>;
  /** A marked row was opened, so what marked it is read. */
  opened: (key: string) => void;
}

const NONE: ReadonlySet<string> = new Set();
const UNMARKED: RowMarks = { useMarked: () => NONE, opened: () => undefined };

/** The app's row marks; give a `RowMarks` whose `useMarked` is one stable hook. */
export const RowMarksContext = createContext<RowMarks>(UNMARKED);

/** A list's marked rows, and what to call when one of them is opened. */
export function useRowMarks(keys: readonly string[]): { marked: ReadonlySet<string>; opened: (key: string) => void } {
  const marks = useContext(RowMarksContext);
  return { marked: marks.useMarked(keys), opened: marks.opened };
}
