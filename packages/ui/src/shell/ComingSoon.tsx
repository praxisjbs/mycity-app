/**
 * @component ComingSoon
 * @group Shell
 * @summary The card a screen shows before its milestone opens it: the milestone and date, one line, and what the screen will do.
 * @use In place of a screen the delivery plan has not opened yet (F14: production after API, UI and Mobile are ticked, staging after API). The shell renders it; a feature never does.
 * @avoid An empty list (use EmptyState); a screen the person may not open (the shell hides it); a page of explanation (at most three short lines of what it will do).
 * @phone Full width, centred, the same parts; the action is a 44 px target.
 * @a11y The heading is a real heading (h2 unless set); the list of what it will do is a list; the milestone pill is plain text.
 * @status stable
 * @example <ComingSoon milestone="Milestone 2 · 06/11/2026" line="Opens with Milestone 2." features={["Your KPIs for the month"]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Pill } from "../display/Pill";

export interface ComingSoonProps {
  /** The heading; Coming Soon unless set. */
  title?: string;
  /** The milestone and date, as one pill ("Milestone 2 · 06/11/2026"); left out for a stranger on the public site. */
  milestone?: ReactNode;
  /** One line under the heading, at most 12 words. */
  line?: ReactNode;
  /** What the screen will do: at most three short lines. */
  features?: string[];
  /** At most one action (See Full Design, in a preview). */
  action?: ReactNode;
  /** Draw it without its card, inside a page that already has one (the public site). */
  bare?: boolean;
  /** The heading level; h2 unless the page's outline needs h3. */
  level?: 2 | 3;
  /** Layout classes only (spacing). */
  className?: string;
}

export function ComingSoon({ title = "Coming Soon", milestone, line, features = [], action, bare, level = 2, className }: ComingSoonProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section
      data-coming-soon=""
      className={cn("flex flex-col items-center px-4 py-8 text-center", !bare && "rounded-card border border-border bg-card text-card-foreground shadow-1", className)}
    >
      <span className="mb-3 flex size-12 items-center justify-center rounded-card bg-accent text-accent-foreground">
        <Icon name="clock" size="m" />
      </span>
      {milestone != null && (
        <span className="mb-2">
          <Pill tone="warn">{milestone}</Pill>
        </span>
      )}
      <Heading data-ui="title" className="text-lg font-strong">
        {title}
      </Heading>
      {line != null && <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted-foreground">{line}</p>}
      {features.length > 0 && (
        <ul className="mx-auto my-4 flex list-none flex-col gap-2 p-0 text-left text-sm text-muted-foreground">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Icon name="ok" className="mt-0.5 text-success" />
              {f}
            </li>
          ))}
        </ul>
      )}
      {action != null && <div className={features.length ? undefined : "mt-4"}>{action}</div>}
    </section>
  );
}
