/**
 * @component Reveal
 * @group Layout
 * @summary A block that rises into view as it scrolls in (from below, or from the left or right) and fades back out when it leaves, so it rises again when it returns; once in view it can lift under the pointer. `scroll` ties the rise to the scroll itself instead. Stagger rises a row of blocks in turn.
 * @use The public site's motion, which a page takes only through these (FRONTEND_GUIDE §6): the index's sections (a head, a tile, a call to action from each side), Stagger for a row of tiles or steps (each 120 ms after the one before), and `scroll` for the careers list's aside and a vacancy's parts.
 * @avoid The staff app, whose motion is the components' own (F6); a list's rows (the list rises as one); anything a person must read before scrolling (the hero and the page intro rise by themselves).
 * @phone The same rise, from below even for a block from a side (a phone has no room at its sides); there is no hover on a phone, so a block never lifts.
 * @a11y Layout only: the block stays in the page and in reading order while it is out of view, and under reduced motion it simply shows. Nothing takes focus. Stagger keeps its items' order and their list semantics (ol, ul with li).
 * @status beta
 * @example <Reveal>{sectionHead}</Reveal>
 * @example <Reveal as="article" from="left" lift="shadow">{callToAction}</Reveal>
 * @example <Reveal delay={120} lift>{tile}</Reveal>
 * @example <Reveal scroll as="section">{part}</Reveal>
 * @example <Stagger as="ol" step={120} className="grid grid-cols-4 gap-6">{steps}</Stagger>
 * @exports Stagger
 */
import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface RevealProps {
  /** The block. */
  children: ReactNode;
  /** The element it is: div unless set (an article for a card, a li inside a list, a section). */
  as?: "div" | "article" | "section" | "li" | "header" | "aside";
  /** Where it rises from: `up` (the default, 24 px below), `left` or `right` (32 px to that side). */
  from?: "up" | "left" | "right";
  /** How long it waits after coming into view, in ms (the second tile in a row 80, the third 200). */
  delay?: number;
  /** Once in view, it rises 4 px under the pointer; `shadow` also lays the site's shadow under it. */
  lift?: boolean | "shadow";
  /** The rise follows the scroll itself (the block is fully in once it has come a third of the way in), where the browser can; elsewhere it simply shows. `from`, `delay` and `lift` do not apply. */
  scroll?: boolean;
  /** The element's id, for a link to this part of the page ("/#hire"). */
  id?: string;
  /** Layout classes only (a grid span, spacing); the block's own look comes from what is inside it. */
  className?: string;
}

/** One observer for every block on the page: in view at 12 % shown, and out again below it. */
let observer: IntersectionObserver | null = null;
let made: typeof IntersectionObserver | null = null;
const seen = new Map<Element, (visible: boolean) => void>();

function watch(el: Element, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  if (made !== IntersectionObserver) {
    observer?.disconnect();
    observer = null;
    made = IntersectionObserver;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.get(e.target)?.(e.isIntersecting);
    },
    { threshold: 0.12 },
  );
  seen.set(el, onChange);
  observer.observe(el);
  return () => {
    seen.delete(el);
    observer?.unobserve(el);
  };
}

export function Reveal({ children, as: Tag = "div", from = "up", delay = 0, lift, scroll, id, className }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || scroll) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    return watch(el, setVisible);
  }, [scroll]);

  if (scroll)
    return (
      <Tag id={id} data-reveal-scroll="" className={cn(className) || undefined}>
        {children}
      </Tag>
    );

  const style = delay ? ({ "--rd": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag
      ref={ref as never}
      id={id}
      data-reveal={from}
      data-visible={visible || undefined}
      data-lift={lift === true ? "" : lift || undefined}
      style={style}
      className={cn(className) || undefined}
    >
      {children}
    </Tag>
  );
}

export interface StaggerProps {
  /** The blocks, each rising in turn: every child is one item. */
  children: ReactNode;
  /** The element that holds them: div unless set (ol or ul for steps and a list, whose items are then li). */
  as?: "div" | "ol" | "ul";
  /** How much later each item rises than the one before, in ms; 120 unless set. */
  step?: number;
  /** How long the first item waits, in ms; 0 unless set. */
  start?: number;
  /** Where each item rises from (Reveal `from`). */
  from?: "up" | "left" | "right";
  /** Each item lifts under the pointer once in view (Reveal `lift`). */
  lift?: boolean | "shadow";
  /** Layout classes only, for the holder (a grid and its gap). */
  className?: string;
  /** Layout classes only, for each item (a span in the grid). */
  itemClassName?: string;
}

/** A row of blocks that rise into view in turn, each `step` ms after the one before. */
export function Stagger({ children, as: Tag = "div", step = 120, start = 0, from, lift, className, itemClassName }: StaggerProps) {
  const item = Tag === "div" ? "div" : "li";
  return (
    <Tag className={cn(Tag !== "div" && "m-0 list-none p-0", className) || undefined}>
      {Children.toArray(children).map((child, i) => (
        <Reveal key={i} as={item} from={from} lift={lift} delay={start + i * step} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}
