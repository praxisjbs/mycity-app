/**
 * @component MoreSheet
 * @group Shell
 * @summary The phone's More: a launcher in a bottom sheet with the person's row, a search bar, the modules they may open as tiles four to a row, and Sign Out (F17).
 * @use Opened by the bottom bar's More. Tiles come from the module catalogue filtered by the person's grants, grouped Work, People, Business and System, each one word with its count.
 * @avoid Desktop (the Rail and the account menu); actions inside a module (Menu); settings that need a form (Settings).
 * @phone The whole point: up to 90% of the height, closed by dragging down, tapping the scrim or Esc; every tile and button a 44 px target.
 * @a11y A dialog named More. The person's row and the groups are labelled; each tile is a link named by its word and its count; the current module is aria-current="page".
 * @status stable
 * @example <MoreSheet open={open} onClose={close} person={{ name: "Cynthia Osakunih", subtitle: "Operations Manager" }} groups={groups} onSearch={openSearch} onSignOut={signOut} />
 */
import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Avatar } from "../display/Avatar";
import { CountBadge } from "../display/CountBadge";
import { Button } from "../actions/Button";
import { Sheet } from "../overlay/Sheet";

/** One module tile. */
export interface LauncherTile {
  /** The module key. */
  key: string;
  /** One word. */
  label: string;
  /** Its glyph. */
  icon: IconName;
  /** Its address. */
  href: string;
  /** Things waiting in it; nothing is drawn for 0. */
  count?: number;
}

/** A labelled group of tiles. */
export interface LauncherGroup {
  /** Work, People, Business or System. */
  label: string;
  /** The tiles, in catalogue order. */
  tiles: LauncherTile[];
}

/** The person at the top of the sheet. */
export interface MorePerson {
  /** Their name. */
  name: string;
  /** Their job title. */
  subtitle?: string;
  /** Their photo, if they have one. */
  photo?: string | null;
}

export interface MoreSheetProps {
  /** Whether the sheet is showing. */
  open: boolean;
  /** Called when the person dismisses it, or after a tile is chosen. */
  onClose: () => void;
  /** The signed-in person. */
  person: MorePerson;
  /** Beside the person: IconButtons for Theme, Density and Settings. */
  personActions?: ReactNode;
  /** Opens full search (the command palette); the search bar is hidden without it. */
  onSearch?: () => void;
  /** The module tiles, by group; empty groups are not drawn. */
  groups: LauncherGroup[];
  /** The module in view, by key. */
  current?: string | null;
  /** Called with a tile's href on a plain tap; the sheet closes. */
  onNavigate?: (href: string) => void;
  /** More rows above Sign Out (Install App). */
  extra?: ReactNode;
  /** Signs the person out. */
  onSignOut: () => void;
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function MoreSheet({ open, onClose, person, personActions, onSearch, groups, current, onNavigate, extra, onSignOut, container }: MoreSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="More" hideHeader container={container} bodyClassName="px-4 pt-2 pb-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3" role="group" aria-label="Your Account">
          <Avatar name={person.name} src={person.photo} size="lg" tone="brand" />
          <span className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-md font-strong" data-copy="content">
              {person.name}
            </b>
            {person.subtitle && (
              <span className="block truncate text-xs text-muted-foreground" data-copy="content">
                {person.subtitle}
              </span>
            )}
          </span>
          {personActions != null && <span className="flex flex-none items-center gap-0.5">{personActions}</span>}
        </div>

        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            data-ui="button"
            className="flex min-h-tap w-full items-center gap-2 rounded-full border border-border bg-muted px-4 text-base text-subtle-foreground"
          >
            <Icon name="srch" />
            Search
          </button>
        )}

        {groups
          .filter((g) => g.tiles.length > 0)
          .map((g) => {
            const id = `more-${g.label.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <section key={g.label} aria-labelledby={id}>
                <h3 id={id} data-ui="title" className="mb-2 text-2xs font-strong tracking-widest text-subtle-foreground uppercase">
                  {g.label}
                </h3>
                <ul className="grid grid-cols-4 gap-1">
                  {g.tiles.map((t) => {
                    const on = t.key === current;
                    return (
                      <li key={t.key}>
                        <a
                          href={t.href}
                          aria-current={on ? "page" : undefined}
                          onClick={(e) => {
                            if (plain(e)) {
                              if (onNavigate) {
                                e.preventDefault();
                                onNavigate(t.href);
                              }
                              onClose();
                            }
                          }}
                          className="flex min-h-tap flex-col items-center gap-1.5 rounded-box px-0.5 py-2 text-foreground no-underline"
                        >
                          <span className={cn("relative flex size-12 items-center justify-center rounded-card", on ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                            <Icon name={t.icon} size="l" />
                            {!!t.count && <CountBadge count={t.count} className="absolute -top-1 -right-1" />}
                          </span>
                          <span data-ui="nav-label" className="w-full truncate text-center text-xs font-medium">
                            {t.label}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

        {extra}

        <Button variant="ghost" block icon="logout" onClick={onSignOut}>
          Sign Out
        </Button>
      </div>
    </Sheet>
  );
}
