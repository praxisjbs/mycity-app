/**
 * @component SectionNav
 * @group Navigation
 * @summary A long page's contents: its sections as links with icons, the one in view marked as the page scrolls, a press scrolling to it.
 * @use The public site's Help page, at the left of the guide (`column`, inside StickyColumns aside) and as a row under the header on a phone (`bar`).
 * @avoid Switching what a page shows (use Tabs or SegmentedControl); narrowing a list (use Chips or TeamList); the staff app's User Guide (use Reader).
 * @phone `bar`: one row of pills that sticks under the header and scrolls sideways inside itself, the one in view kept in sight; each is a 44 px target. `column` is left off below 1041 px and `bar` above it, so a page gives both.
 * @a11y A nav named by `label` of real links to each section's id, the one in view marked aria-current="location". The caller gives each section its id and a scroll margin under the header.
 * @status beta
 * @example <SectionNav label="Help Contents" items={[{ id: "public-home", label: "Home", icon: "home" }, { id: "public-apply", label: "Apply", icon: "send" }]} />
 * @example <SectionNav variant="bar" label="Help Contents" items={items} />
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";
import { StickyTop } from "../layout/sticky";

/** One section of the page: the id its heading carries, its name and its icon. */
export interface SectionNavItem {
  /** The id of the section's heading on the page (`public-apply`). */
  id: string;
  /** The section's name, as its heading reads (Apply for a Role). */
  label: string;
  /** A Lucide icon for the section. */
  icon?: IconName;
}

export interface SectionNavProps {
  /** Names the nav for assistive technology (Help Contents). */
  label: string;
  /** The sections, top to bottom. */
  items: ReadonlyArray<SectionNavItem>;
  /** `column` (the default): a column of rows, desktop only. `bar`: a row of pills under the header, below 1041 px only. */
  variant?: "column" | "bar";
  /** A heading over the column, in spaced capitals (On This Page); the bar has none. */
  title?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/** How far under the top of the screen a heading counts as the one being read, in px. */
const READ_LINE = 140;

/** The section being read: the last whose heading has passed the reading line; the first at the top of the page. */
function inView(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  if (window.scrollY < 8) return ids[0] ?? null;
  let at = ids[0] ?? null;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= READ_LINE) at = id;
  }
  /* At the foot of the page the last section is the one read, however short it is. */
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) at = ids[ids.length - 1] ?? at;
  return at;
}

/** The section in view, followed as the page scrolls. */
function useInView(ids: readonly string[]) {
  const key = ids.join(" ");
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const list = key ? key.split(" ") : [];
    let frame = 0;
    const read = () => {
      frame = 0;
      setCurrent(inView(list));
    };
    const soon = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => {
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return [current, setCurrent] as const;
}

export function SectionNav({ label, items, variant = "column", title, className }: SectionNavProps) {
  const ids = items.map((i) => i.id);
  const [current, setCurrent] = useInView(ids);
  const bar = variant === "bar";
  const root = useRef<HTMLElement>(null);
  const head = useContext(StickyTop);

  /* The bar sticks under the header: its top is the header's height, written as the column's is (StickyColumns). */
  useLayoutEffect(() => {
    if (bar) root.current?.style.setProperty("--stick-top", `${head}px`);
  }, [bar, head]);

  /* The bar keeps the pill in view in sight, scrolling only its own row, never the page. */
  useEffect(() => {
    if (!bar || !current) return;
    const row = root.current?.querySelector("ul");
    const pill = row?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!row || !pill) return;
    const left = pill.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + pill.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo?.({ left: Math.max(0, left - 16), behavior: "smooth" });
  }, [bar, current]);

  const go = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    setCurrent(id);
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    window.history.replaceState(window.history.state, "", `#${id}`);
  };

  return (
    <nav ref={root} aria-label={label} data-variant={variant} className={cn("ps-secnav", bar ? "ps-secnav-bar lg:hidden" : "max-lg:hidden", className)}>
      {!bar && title != null && (
        <h2 data-ui="title" className="ps-eyebrow m-0">
          {title}
        </h2>
      )}
      <ul>
        {items.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} data-section={s.id} aria-current={s.id === current ? "location" : undefined} onClick={go(s.id)}>
              {s.icon && <Icon name={s.icon} />}
              <span {...content}>{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
