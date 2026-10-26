import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RowMarksContext, type RowMarks } from "@mycity/ui";
import { api } from "@/api/client";
import { refresh, useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";

/**
 * Where something new waits inside a module (docs/guides/notifications.md §6). Each tab's count
 * comes from the badges (shell/nav.ts tabItems); here a list on the screen marks the rows its
 * reader has an unread notice about (DataView's dot and tint), and opening one, from its row or
 * by its address (`?id=` or a record's own key), reads those notices: the dot goes at once, and
 * the tab's count, the module's and the bell follow, on every device (`notification_read`).
 *
 * A list asks only while its tab counts something, for the ids on its page (at most 25).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Screen {
  module: string;
  tab: string;
  /** Unread notices opening on this tab: none, and no list asks. */
  count: number;
  /** Rows opened here whose read is on its way: unmarked meanwhile. */
  opened: ReadonlySet<string>;
}

const ScreenContext = createContext<Screen | null>(null);

/** The rows of a list on this screen with something unread about them. RowMarks' hook: one for every list. */
function useUnreadRows(keys: readonly string[]): ReadonlySet<string> {
  const screen = useContext(ScreenContext);
  const ids = keys.filter((k) => UUID.test(k)).slice(0, 25);
  const enabled = !!screen && screen.count > 0 && ids.length > 0;
  const { data } = useApi("GET /api/v1/notifications/unread-records", {
    query: { module: screen?.module ?? "", tab: screen?.tab ?? "", ids: ids.join(",") },
    enabled,
  });
  const opened = screen?.opened;
  return useMemo(() => new Set(enabled ? (data?.ids ?? []).filter((id) => !opened?.has(id)) : []), [enabled, data, opened]);
}

/** Around every screen of the shell: the screen in view and how many unread notices open on it. */
export function RecordMarks({ module, tab, count, children }: { module: string | null; tab: string | null; count: number; children: ReactNode }) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const sending = useRef(new Set<string>());

  /** Reads the notices about one record that open on this screen; quiet when it fails, so its dot comes back. */
  const read = useCallback(
    (id: string) => {
      if (!module || !tab) return;
      const key = `${module}/${tab}/${id}`;
      if (sending.current.has(key)) return;
      sending.current.add(key);
      setOpened((o) => new Set(o).add(id));
      void api
        .call("POST /api/v1/notifications/read-record", { body: { module, tab, entity_id: id } })
        .then(() => refresh("/api/v1/notifications"))
        .catch(() => undefined)
        .finally(() => {
          sending.current.delete(key);
          setOpened((o) => {
            const next = new Set(o);
            next.delete(id);
            return next;
          });
        });
    },
    [module, tab],
  );

  // A record opened by its address: a link, a notice, a row that navigates to its record.
  const { location } = useRouter();
  const waiting = count > 0;
  const shown = [...location.params]
    .filter(([name, value]) => name !== "n" && UUID.test(value))
    .map(([, value]) => value)
    .join(",");
  useEffect(() => {
    if (waiting && shown) shown.split(",").forEach(read);
  }, [waiting, shown, read]);

  const screen = useMemo(() => (module && tab ? { module, tab, count, opened } : null), [module, tab, count, opened]);
  const marks = useMemo<RowMarks>(() => ({ useMarked: useUnreadRows, opened: read }), [read]);
  return (
    <ScreenContext.Provider value={screen}>
      <RowMarksContext.Provider value={marks}>{children}</RowMarksContext.Provider>
    </ScreenContext.Provider>
  );
}
