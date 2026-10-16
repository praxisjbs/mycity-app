/**
 * @component CommandPalette
 * @group Shell
 * @summary ⌘K: one search line over screens and records from the server's search, grouped, moved through with the arrow keys and opened with Enter.
 * @use Once, by the staff app's shell: ⌘K or Ctrl K, the top bar's SearchButton, the phone's search icon and More's search bar all open it. The app sends the query to GET /api/v1/search and passes the first page of results.
 * @avoid Searching one list (SearchInput, which filters that list on the server); a picker inside a form (PersonPicker, RecordPicker); filtering rows on the client.
 * @phone A full-screen sheet with the search line at the top and Close beside it; results are 44 px rows.
 * @a11y A dialog named Search. The line is a combobox that owns the result list (aria-activedescendant follows the arrow keys); results are options in labelled groups; Esc closes and focus returns to what opened it.
 * @status stable
 * @example <CommandPalette open={open} onClose={close} query={q} onQueryChange={setQ} results={hits} onSelect={(r) => navigate(r.href)} />
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";
import { Spinner } from "../display/Skeleton";
import { InlineInput } from "../form/InlineInput";
import { useReturnFocus } from "../overlay/context";

/** One result: a screen or a record. */
export interface PaletteResult {
  /** Unique within the list. */
  key: string;
  /** The heading it is listed under (Screens, People, Expenses). */
  group: string;
  /** What it is: the screen's or the record's name. */
  title: string;
  /** A second word at the right: the module, a status, a number. */
  subtitle?: string;
  /** Its glyph; a chevron unless set. */
  icon?: IconName;
  /** Where it goes. */
  href: string;
}

export interface CommandPaletteProps {
  /** Whether the palette is showing. */
  open: boolean;
  /** Called on Esc, a click outside, Close, or after a result is chosen. */
  onClose: () => void;
  /** The search line. */
  query: string;
  /** Called on each key with the new line; the app sends it to the server as q. */
  onQueryChange: (query: string) => void;
  /** The first page of results, in the order the server ranked them. */
  results: PaletteResult[];
  /** A search is in flight. */
  loading?: boolean;
  /** Called with the chosen result. */
  onSelect: (result: PaletteResult) => void;
  /** The format example in the line, at most 3 words; Screens, People, Records unless set. */
  placeholder?: string;
  /** Where it mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

export function CommandPalette({ open, onClose, query, onQueryChange, results, loading = false, onSelect, placeholder = "Screens, People, Records", container }: CommandPaletteProps) {
  const phone = useIsPhone();
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const returnFocus = useReturnFocus(open);

  useEffect(() => setCur(0), [query, results.length]);
  useEffect(() => {
    document.getElementById(`${list}-${cur}`)?.scrollIntoView?.({ block: "nearest" });
  }, [cur, list]);

  const choose = (r: PaletteResult | undefined) => {
    if (!r) return;
    onSelect(r);
    onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCur((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[cur]);
    }
  };

  const groups: Array<{ name: string; items: Array<{ r: PaletteResult; i: number }> }> = [];
  results.forEach((r, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === r.group) last.items.push({ r, i });
    else groups.push({ name: r.group, items: [{ r, i }] });
  });
  const active = results[cur] ? `${list}-${cur}` : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className={cn("fixed inset-x-0 top-(--env-bar) bottom-0 z-50 bg-scrim", !phone && "flex items-start justify-center px-4 pt-24 pb-4 backdrop-blur-xs")}>
          <Dialog.Content
            data-ui="modal"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              input.current?.focus();
            }}
            onCloseAutoFocus={returnFocus}
            className={cn(
              "flex flex-col text-foreground outline-none",
              phone ? "h-full bg-background pt-safe" : "max-h-full w-full max-w-140 animate-rise overflow-hidden rounded-sheet border border-glass-border bg-glass shadow-3 backdrop-blur-xl",
            )}
          >
            <Dialog.Title className="sr-only">Search</Dialog.Title>
            <div className="flex flex-none items-center gap-2.5 border-b border-glass-border px-4 py-2.5">
              <Icon name="srch" size="m" className="text-subtle-foreground" />
              <InlineInput
                ref={input}
                role="combobox"
                aria-label="Search"
                aria-expanded={results.length > 0}
                aria-controls={list}
                aria-autocomplete="list"
                aria-activedescendant={active}
                autoComplete="off"
                spellCheck={false}
                className="min-h-tap min-w-0 flex-1 border-0 bg-transparent text-md outline-none phone:text-lg"
                placeholder={placeholder}
                value={query}
                onChange={onQueryChange}
                onKeyDown={onKey}
              />
              {loading && <Spinner />}
              {phone && <IconButton icon="x" label="Close Search" onClick={onClose} />}
            </div>
            <div id={list} role="listbox" aria-label="Results" className={cn("overflow-y-auto p-1.5", phone ? "min-h-0 flex-1" : "max-h-84")}>
              {results.length === 0 && !loading && (
                <p className="px-3 py-6 text-center text-sm text-subtle-foreground">{query.trim() ? "Nothing matches" : "Type to search"}</p>
              )}
              {groups.map((g) => {
                const gid = `${list}-g-${g.items[0]!.i}`;
                return (
                  <div key={gid} role="group" aria-labelledby={gid}>
                    <div id={gid} role="presentation" className="px-3 pt-2.5 pb-1 text-2xs font-strong tracking-widest text-subtle-foreground uppercase">
                      {g.name}
                    </div>
                    {g.items.map(({ r, i }) => (
                      <div
                        key={r.key}
                        id={`${list}-${i}`}
                        role="option"
                        aria-selected={i === cur}
                        onMouseEnter={() => setCur(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(r)}
                        className={cn("flex min-h-10 cursor-pointer items-center gap-3 rounded-ctl px-3 py-2 text-base phone:min-h-tap", i === cur && "bg-accent")}
                      >
                        <Icon name={r.icon ?? "right"} className="flex-none text-accent-foreground" />
                        <span className="min-w-0 flex-1 truncate" data-copy="content">
                          {r.title}
                        </span>
                        {r.subtitle && (
                          <span className="ml-auto flex-none text-2xs text-subtle-foreground" data-copy="content">
                            {r.subtitle}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
