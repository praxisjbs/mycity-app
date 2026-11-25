import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RowMarksContext, type ChoiceOption, type RowMarks } from "@mycity/ui";
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
 * The screen asks once for every list on it, not once per list (a Goals tab with an objective
 * card per list asked about 25 times): each list hands its page's ids to RecordMarks, which asks
 * for all of them together, 25 ids a request (the server's cap and the pagination rule), and only
 * while the tab counts something. Each list then marks its own rows from the one answer.
 *
 * Inside the tab, its switch and chips carry their share too (`GET /notifications/views`, each
 * record placed by its module where the screen's own filters find it), and the screen opens on
 * the one holding the news when the one it opens on holds none:
 *
 *   const news = useViewNews();
 *   useOpenWhereNews({ value: side, onChange: setSide, values: ["permanent", "temporary"] });
 *   <SegmentedControl options={withNews(news, SIDES)} … />            // Temporary 2
 *   <Chips options={withNews(news, STATE_CHIPS, { at: "temporary", all: "all" })} … />
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Screen {
  module: string;
  tab: string;
  /** Unread notices opening on this tab: none, and no list asks. */
  count: number;
  /** Rows opened here whose read is on its way: unmarked meanwhile. */
  opened: ReadonlySet<string>;
  /** The records on this screen with an unread notice that opens here, from the screen's one batch. */
  unread: ReadonlySet<string>;
  /** A list hands over its page's record ids; the function it returns takes them back. */
  register: (list: object, ids: string) => () => void;
  /** What waits in each inner view, by path ("temporary/cancelled"); undefined until read, and while nothing waits. */
  views: Readonly<Record<string, ViewNews>> | undefined;
}

/** What waits in one inner view of the screen in view. */
export interface ViewNews {
  unread: number;
  urgent: boolean;
}

/** What waits in a view of the screen in view, by its path: "temporary", "temporary/cancelled"; "" the whole screen's placed news. */
export type NewsAt = (path: string) => ViewNews | undefined;

const ScreenContext = createContext<Screen | null>(null);

const NONE: ReadonlySet<string> = new Set();

/** Ids a request carries at most: the server's cap, the pagination rule's 25. */
const BATCH = 25;
/** How long the screen waits for its lists to settle before it asks, so lists that load together ask together. */
const SETTLE_MS = 30;

/** The rows of a list on this screen with something unread about them. RowMarks' hook: one for every list. */
function useUnreadRows(keys: readonly string[]): ReadonlySet<string> {
  const screen = useContext(ScreenContext);
  const ids = keys.filter((k) => UUID.test(k)).join(",");
  const [list] = useState(() => ({}));
  const register = screen?.register;
  useEffect(() => (register && ids ? register(list, ids) : undefined), [register, list, ids]);
  const unread = screen?.unread;
  const opened = screen?.opened;
  return useMemo(() => {
    if (!ids || !unread?.size) return NONE;
    return new Set(ids.split(",").filter((id) => unread.has(id) && !opened?.has(id)));
  }, [ids, unread, opened]);
}

/**
 * One request of the screen's batch: up to 25 of its ids. A read like any other (useApi), so a read
 * mark, the pull and the refresh button ask it again with the rest of the screen.
 */
function UnreadBatch({ module, tab, ids, onAnswer }: { module: string; tab: string; ids: string; onAnswer: (screen: string, ids: string, found: readonly string[]) => void }) {
  const { data } = useApi("GET /api/v1/notifications/unread-records", { query: { module, tab, ids } });
  useEffect(() => {
    if (data) onAnswer(`${module}/${tab}`, ids, data.ids);
  }, [data, module, tab, ids, onAnswer]);
  return null;
}

/** What the screen's answers say about each record id it asked for, for one screen. */
interface Known {
  screen: string;
  unread: ReadonlyMap<string, boolean>;
}
const FORGOTTEN: Known = { screen: "", unread: new Map() };

/** The ids every list on the screen hands over, gathered once they settle: sorted, each once, in batches of 25. */
function useScreenIds() {
  const lists = useRef(new Map<object, string>());
  const [wanted, setWanted] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gather = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const all = new Set<string>();
      for (const ids of lists.current.values()) for (const id of ids.split(",")) all.add(id);
      setWanted([...all].sort().join(","));
    }, SETTLE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const register = useCallback(
    (list: object, ids: string) => {
      lists.current.set(list, ids);
      gather();
      return () => {
        lists.current.delete(list);
        gather();
      };
    },
    [gather],
  );
  const batches = useMemo(() => {
    const ids = wanted ? wanted.split(",") : [];
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH).join(","));
    return out;
  }, [wanted]);
  return { register, batches };
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

  const { data: placed } = useApi("GET /api/v1/notifications/views", {
    query: { module: module ?? "", tab: tab ?? "" },
    enabled: !!module && !!tab && waiting,
  });
  const views = waiting ? placed?.views : undefined;

  // Every list's ids, asked for together: one batch for the screen, 25 ids a request.
  const { register, batches } = useScreenIds();
  // Each answer is kept by record, so a list joining the screen (its batches re-cut) never makes the
  // others' dots blink while the new batches are asked; a new screen starts afresh.
  const [known, setKnown] = useState<Known>(FORGOTTEN);
  const answer = useCallback((screen: string, ids: string, found: readonly string[]) => {
    setKnown((was) => {
      const hit = new Set(found);
      const next = new Map(was.screen === screen ? was.unread : []);
      for (const id of ids.split(",")) next.set(id, hit.has(id));
      return { screen, unread: next };
    });
  }, []);
  // Nothing waits on the tab any more: forget, so a later notice never shows an old dot first.
  useEffect(() => {
    if (!waiting) setKnown(FORGOTTEN);
  }, [waiting]);
  const asking = !!module && !!tab && waiting;
  const unread = useMemo(() => {
    if (!asking || known.screen !== `${module}/${tab}`) return NONE;
    const out = new Set<string>();
    for (const [id, on] of known.unread) if (on) out.add(id);
    return out;
  }, [asking, known, module, tab]);

  const screen = useMemo(
    () => (module && tab ? { module, tab, count, opened, views, unread, register } : null),
    [module, tab, count, opened, views, unread, register],
  );
  const marks = useMemo<RowMarks>(() => ({ useMarked: useUnreadRows, opened: read }), [read]);
  return (
    <ScreenContext.Provider value={screen}>
      {asking && module && tab ? batches.map((ids) => <UnreadBatch key={`${module}/${tab}/${ids}`} module={module} tab={tab} ids={ids} onAnswer={answer} />) : null}
      <RowMarksContext.Provider value={marks}>{children}</RowMarksContext.Provider>
    </ScreenContext.Provider>
  );
}

/**
 * What waits in each inner view of the screen in view: a lookup by path. Outside the shell (a
 * test of one screen), and while the tab counts nothing, every view reads nothing.
 */
export function useViewNews(): NewsAt {
  const views = useContext(ScreenContext)?.views;
  return useCallback(
    (path: string) => {
      if (path) return views?.[path];
      // The whole screen: its outermost views together (a chip that shows everything at the top).
      const top = Object.entries(views ?? {}).filter(([p]) => !p.includes("/"));
      if (!top.length) return undefined;
      return { unread: top.reduce((n, [, v]) => n + v.unread, 0), urgent: top.some(([, v]) => v.urgent) };
    },
    [views],
  );
}

/**
 * A switch's or a row of chips' options with what waits behind each: an option's path is its value,
 * under `at` when the views sit inside another ("temporary" → "temporary/cancelled"), and the `all`
 * option reads the whole of `at`.
 */
export function withNews<V extends string>(
  news: NewsAt,
  options: ReadonlyArray<readonly [V, string] | ChoiceOption<V>>,
  { at, all }: { at?: string; all?: NoInfer<V> } = {},
): ChoiceOption<V>[] {
  return options.map((o) => {
    const option: ChoiceOption<V> = Array.isArray(o) ? { value: o[0], label: o[1] } : (o as ChoiceOption<V>);
    const here = news(option.value === all ? (at ?? "") : at ? `${at}/${option.value}` : option.value);
    return here ? { ...option, unread: here.unread, urgent: here.urgent } : option;
  });
}

/**
 * Opens a switch or a row of chips where the news is, once: when what waits on this screen is
 * read and the option it opened on holds none of it, the option that does (`all` when several do,
 * or when only `all` does: a record in a state no other chip shows). Never after the person
 * chose, nor when `skip` (a record opened by its link, which picks its own view). `values` are the
 * options on offer now; while there are none it waits.
 */
export function useOpenWhereNews<V extends string>({
  value,
  onChange,
  values,
  at,
  all,
  skip = false,
}: {
  value: V;
  onChange: (value: NoInfer<V>) => void;
  values: readonly NoInfer<V>[];
  at?: string;
  all?: NoInfer<V>;
  skip?: boolean;
}) {
  const news = useViewNews();
  const first = useRef(value);
  const done = useRef(false);
  const weight = (v: V) => {
    const w = news(v === all ? (at ?? "") : at ? `${at}/${v}` : v);
    return w ? Math.max(w.unread, w.urgent ? 1 : 0) : 0;
  };
  const holding = values.filter((v) => v !== all && weight(v) > 0);
  const allHolds = all !== undefined && values.includes(all) && weight(all) > 0;
  const here = value === all ? allHolds : weight(value) > 0;
  // All, unless one option holds everything All does.
  const one = holding.length === 1 && (!allHolds || weight(holding[0]) >= weight(all as V));
  const target = one ? holding[0] : allHolds ? (all as V) : (holding[0] ?? null);
  const read = allHolds || holding.length > 0 || here;
  // Options still being worked out (who may see My Team) are none yet: it waits for them.
  const offered = values.length > 0;
  useEffect(() => {
    if (done.current || !read || !offered) return;
    done.current = true;
    if (skip || value !== first.current || here || target === null) return;
    onChange(target);
  }, [read, offered, skip, value, here, target, onChange]);
}
