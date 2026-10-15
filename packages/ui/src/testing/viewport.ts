/**
 * A test's screen width. jsdom has no layout and no `matchMedia`, so this answers
 * `(max-width: N px)` and `(min-width: N px)` queries from a width the test sets:
 * `setViewport(390)` is a phone, `setViewport(1440)` a desktop (the gates' sizes).
 * `prefers-color-scheme` and `prefers-reduced-motion` answer false.
 */
type Listener = (e: MediaQueryListEvent) => void;

let width = 1440;
const lists = new Set<{ query: string; listeners: Set<Listener>; last: boolean }>();

function evaluate(query: string): boolean {
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  if (!max && !min) return false;
  return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const entry = { query, listeners: new Set<Listener>(), last: evaluate(query) };
    lists.add(entry);
    return {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, l: Listener) => entry.listeners.add(l),
      removeEventListener: (_: string, l: Listener) => entry.listeners.delete(l),
      addListener: (l: Listener) => entry.listeners.add(l),
      removeListener: (l: Listener) => entry.listeners.delete(l),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
}

/** Set the width and tell every query whose answer changed. */
export function setViewport(next: number): void {
  width = next;
  for (const entry of lists) {
    const now = evaluate(entry.query);
    if (now !== entry.last) {
      entry.last = now;
      for (const l of entry.listeners) l({ matches: now, media: entry.query } as MediaQueryListEvent);
    }
  }
}
