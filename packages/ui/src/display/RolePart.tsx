/**
 * @component RolePart
 * @group Display
 * @summary One part of a role's page under its heading, a hairline under it to the next part; it rises as it scrolls into view.
 * @use A vacancy's text, part by part: Role Overview, Key Performance Indicators (KPIs), Required Experience and Qualifications, What We Are Looking For, How We Hire. Put the part's own content inside: RichText look site, IconList, Quote look feature, HireSteps compact.
 * @avoid A card (Panel, RoleCard); a page's own head (SkylineHero size role); the staff app.
 * @phone The same part, its heading a little smaller, full width.
 * @a11y A section named by its h2; the heading is the role's own wording where the role sets it (data-copy content) or the page's (data-ui title). Under reduced motion it simply shows.
 * @status beta
 * @example <RolePart title="Role Overview"><RichText look="site" blocks={description} top={3} /></RolePart>
 */
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Reveal } from "../layout/Reveal";

export interface RolePartProps {
  /** The part's heading (Role Overview, Required Experience and Qualifications). */
  title: string;
  /** The heading is the role's own words (a heading from its description), not the page's. */
  record?: boolean;
  /** The part's content. */
  children: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function RolePart({ title, record, children, className }: RolePartProps) {
  const id = useId();
  return (
    <Reveal as="section" scroll className={cn("ps-part", className)}>
      <h2 id={id} {...(record ? { "data-copy": "content" } : { "data-ui": "title" })}>
        {title}
      </h2>
      <div aria-labelledby={id} role="group">
        {children}
      </div>
    </Reveal>
  );
}
