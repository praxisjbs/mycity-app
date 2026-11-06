/**
 * @component Panel
 * @group Layout
 * @summary The public site's card a person works in: white on the City Green ground, 24 px corners, an optional yellow progress bar, a small gold line with a status at its right, a title, the body, and a foot on the hover tint for the buttons.
 * @use The right-hand card of PublicPage layout split: Apply's steps (Wizard look panel draws one), an assessment's intro and its questions, Sign Below, an outcome (a PageMessage inside a bare Panel).
 * @avoid The staff app (use Card); a card inside a card; a list of records (use RoleRow on the careers list); text that explains the system (tier 3).
 * @phone Full width with 20 px inside; the foot keeps its buttons on one line.
 * @a11y The title is an h2 (data-ui title, at most 4 words) and can take focus when the step changes; a section or article Panel is named by it. The progress bar is decorative: the line above the title says the step in words.
 * @status beta
 * @example <Panel eyebrow="Step 1 of 3" progress={{ value: 1, max: 3 }} title="About You" foot={buttons}>{fields}</Panel>
 * @example <Panel bare><PageMessage tone="ok" icon="ok" title="Application Sent" /></Panel>
 */
import { useId, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "../lib/cn";

export interface PanelProps {
  /** The body: fields, a question, an outcome. */
  children?: ReactNode;
  /** The card's heading, Title Case, at most 4 words (About You, Sign Below). */
  title?: ReactNode;
  /** The heading, for a card that moves focus to it when its step changes; it takes focus without a ring. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** The small gold line at the top: where the person is (Step 1 of 3, Question 2 of 3). */
  eyebrow?: ReactNode;
  /** What stands at the right of that line (Saved). */
  status?: ReactNode;
  /** The yellow bar over the top line, filled to value of max. */
  progress?: { value: number; max: number };
  /** The foot, on the hover tint under a hairline: the card's buttons, Back at the left and the next step at the right. */
  foot?: ReactNode;
  /** The body without the card's inner spacing (an outcome, which keeps its own). */
  bare?: boolean;
  /** The element: div unless set; a section or an article is named by its title. */
  as?: "div" | "section" | "article";
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

export function Panel({ children, title, titleRef, eyebrow, status, progress, foot, bare, as: Tag = "div", className }: PanelProps) {
  const id = useId();
  const named = Tag !== "div" && title != null;
  const fill = progress && progress.max > 0 ? `${Math.min(100, Math.max(0, (progress.value / progress.max) * 100))}%` : null;
  return (
    <Tag className={cn("ps-panel", className)} aria-labelledby={named ? id : undefined}>
      {bare ? (
        children
      ) : (
        <div className="ps-panel-in">
          {fill != null && (
            <div className="ps-panel-bar" aria-hidden="true">
              <span style={{ "--fill": fill } as CSSProperties} />
            </div>
          )}
          {(eyebrow != null || status != null) && (
            <div className="ps-panel-top">
              <small>{eyebrow}</small>
              {status}
            </div>
          )}
          {title != null && (
            <h2 id={id} ref={titleRef} tabIndex={titleRef ? -1 : undefined} data-ui="title" className="ps-panel-title">
              {title}
            </h2>
          )}
          {children != null && (title != null ? <div className="ps-panel-body">{children}</div> : children)}
        </div>
      )}
      {foot != null && <div className="ps-panel-foot">{foot}</div>}
    </Tag>
  );
}
