/**
 * @component SectionHead
 * @group Layout
 * @summary The head of a section of a public page: a gold kicker with its rule (or a spaced eyebrow), a large heading with an optional accent word in green, a line under it, and an action at the right; it rises into view.
 * @use The index's sections: What We Build and How We Hire centred (`kicker`, `text`), Closing Soon split with See All Roles at its right (`eyebrow`, `accent`, `action`).
 * @avoid The page's own opening (PageIntro, SkylineHero); a card's title (Panel, CtaCard); the staff app (PageHeader).
 * @phone The same head, the action dropping under the heading when it does not fit beside it.
 * @a11y The heading is an h2 (data-ui title, at most 4 words), with an id for the section's aria-labelledby; the kicker's rule is decorative. It rises as Reveal does, and simply shows under reduced motion.
 * @status beta
 * @example <SectionHead kicker="How We Hire" title="Four Steps, Every Time" text="The same fair process for every role and every candidate." id="hire-title" />
 * @example <SectionHead align="split" eyebrow="Careers" title="Closing Soon" accent="Soon" action={seeAll} id="latest-title" />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Reveal } from "./Reveal";

export interface SectionHeadProps {
  /** The heading, Title Case, at most 4 words (Four Steps, Every Time). */
  title: string;
  /** The word of the title drawn in the brand green (Soon). */
  accent?: string;
  /** The gold line over the heading, after its short rule (How We Hire). */
  kicker?: ReactNode;
  /** The spaced capital line over the heading instead (Careers). */
  eyebrow?: ReactNode;
  /** One line under the heading, a sentence of at most 20 words. */
  text?: ReactNode;
  /** What stands at the right of the heading in a split head (See All Roles). */
  action?: ReactNode;
  /** `center` (the default) or `split`: the heading at the left, the action at the right. */
  align?: "center" | "split";
  /** `l` (the default), a section's heading; `m`, smaller, for a part under a page's own (More Roles). */
  size?: "l" | "m";
  /** The heading's id, for the section's aria-labelledby. */
  id?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

function withAccent(title: string, accent?: string): ReactNode {
  const at = accent ? title.lastIndexOf(accent) : -1;
  if (!accent || at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <em className="ps-accent">{accent}</em>
      {title.slice(at + accent.length)}
    </>
  );
}

export function SectionHead({ title, accent, kicker, eyebrow, text, action, align = "center", size = "l", id, className }: SectionHeadProps) {
  const head = (
    <>
      {kicker != null && <p className="ps-kicker">{kicker}</p>}
      {eyebrow != null && <p className="ps-eyebrow">{eyebrow}</p>}
      <h2 id={id} data-ui="title" className={cn("ps-h2", size === "m" && "ps-h2-m")}>
        {withAccent(title, accent)}
      </h2>
      {text != null && <p className="ps-sub">{text}</p>}
    </>
  );
  return (
    <Reveal className={cn(align === "split" ? "ps-head-split" : "ps-head-c", size === "m" && "mb-6", className)}>
      {align === "split" ? <div>{head}</div> : head}
      {action}
    </Reveal>
  );
}
