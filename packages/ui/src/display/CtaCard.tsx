/**
 * @component CtaCard
 * @group Display
 * @summary A call to action as a large card: Deep Green with a yellow glow, or the site's card, each with its glyph in a soft square, a title, a line and one action at its foot; it slides in from its side and lifts with a shadow under the pointer. CtaCards lays two side by side.
 * @use The foot of the public index: Know Someone Great? (Copy Careers Link) beside Verify a Document.
 * @avoid A notice about the system (Banner); several actions on one card; a record (RoleTile); the staff app.
 * @phone One to a row, 28 px inside; it rises from below rather than from a side.
 * @a11y An article named by its h3 title (data-ui title, at most 4 words); the glyph is decorative; `id` lets a link reach it (/#refer). Under reduced motion it simply shows.
 * @status beta
 * @exports CtaCards
 * @example <CtaCards><CtaCard tone="deep" from="left" id="refer" icon="userplus" title="Know Someone Great?" text="Send them our roles." action={copy} /><CtaCard from="right" delay={120} icon="shieldok" title="Verify a Document" text="Check an offer letter or certificate MyCityApp issued, by its reference." action={verify} /></CtaCards>
 */
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Reveal } from "../layout/Reveal";

export interface CtaCardProps {
  /** The card's title, Title Case, at most 4 words (Know Someone Great?). */
  title: string;
  /** One line under it, a sentence or two of at most 20 words each. */
  text: ReactNode;
  /** The one action at its foot (a Button). */
  action?: ReactNode;
  /** The glyph in its soft square. */
  icon: IconName;
  /** `deep`: Deep Green with a yellow glow; `card` (the default): the site's card. */
  tone?: "deep" | "card";
  /** The side it slides in from: `left` or `right`; from below unless set. */
  from?: "left" | "right";
  /** How long it waits once in view, in ms. */
  delay?: number;
  /** The card's id, for a link to it (/#refer). */
  id?: string;
}

export function CtaCard({ title, text, action, icon, tone = "card", from, delay, id }: CtaCardProps) {
  const titleId = useId();
  return (
    <Reveal as="article" id={id} from={from} delay={delay} lift="shadow" className="ps-cta-wrap">
      <div className="ps-cta" data-tone={tone} {...(tone === "deep" ? { "data-theme": "dark" } : {})} role="group" aria-labelledby={titleId}>
        <span aria-hidden="true" className="ps-cta-ic">
          <Icon name={icon} className="size-7" />
        </span>
        <h3 id={titleId} data-ui="title">
          {title}
        </h3>
        <p>{text}</p>
        {action != null && <div className="ps-cta-act">{action}</div>}
      </div>
    </Reveal>
  );
}

export interface CtaCardsProps {
  /** The cards, each a CtaCard. */
  children: ReactNode;
  /** Layout classes only (the page's width, spacing). */
  className?: string;
}

/** Two calls to action side by side. */
export function CtaCards({ children, className }: CtaCardsProps) {
  return <div className={cn("ps-ctas", className)}>{children}</div>;
}
