/**
 * @component RoleCard
 * @group Display
 * @summary A role's facts on the site's card beside its text: The Role as label and value rows, then on the hover tint the closing date in gold, the Apply action and how many have applied. ShareCard sits under it on a dashed line: pass the role on, with its link to copy.
 * @use A vacancy's aside, in the right column of StickyColumns, so it waits while the text scrolls.
 * @avoid A list of roles (RoleRow); a record in the staff app (Card, KeyValue); a second action beside Apply.
 * @phone The card comes first, above the text; its action area is left off, since the page's bar at the foot carries Apply; ShareCard is left off from 1040 px down.
 * @a11y A section named by its h2 (data-ui title); the values are content; the clock is decorative and the closing date is in words.
 * @status beta
 * @exports ShareCard
 * @example <RoleCard title="The Role" items={[{ label: "Employment", value: "Full Time" }]} closing="Closes 18/11/2026" action={apply} note="12 people have applied" />
 * @example <ShareCard title="Know Someone for This?" text="Send them this role. Their application comes straight to us." action={copy} />
 */
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { KeyValue, type KeyValueItem } from "./KeyValue";

export interface RoleCardProps {
  /** The card's heading, at most 4 words (The Role). */
  title: string;
  /** The role's facts, label and value (Employment, Working Days, Experience, Reports To, Probation). */
  items: ReadonlyArray<KeyValueItem>;
  /** The closing date in words, in gold over the action (Closes 18/11/2026). */
  closing?: ReactNode;
  /** The action (Apply for This Role), full width. */
  action?: ReactNode;
  /** A short line under the action (12 people have applied). */
  note?: ReactNode;
  /** Anything under the card's own parts (a refusal from Apply). */
  children?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function RoleCard({ title, items, closing, action, note, children, className }: RoleCardProps) {
  const id = useId();
  const act = closing != null || action != null || note != null;
  return (
    <section className={cn("ps-card", className)} aria-labelledby={id}>
      <div className="ps-card-head">
        <h2 id={id} data-ui="title">
          {title}
        </h2>
      </div>
      {items.length > 0 && <KeyValue layout="rows" items={items} className="ps-card-kv" />}
      {act && (
        <div className="ps-card-act">
          {closing != null && (
            <span className="ps-closing">
              <Icon name="clock" className="size-4.5" />
              {closing}
            </span>
          )}
          {action}
          {note != null && <p>{note}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface ShareCardProps {
  /** Its heading, at most 4 words (Know Someone for This?). */
  title: string;
  /** One line under it. */
  text: ReactNode;
  /** The action (Copy Role Link). */
  action?: ReactNode;
}

/** Pass the role on: a dashed card under RoleCard, with its link to copy. */
export function ShareCard({ title, text, action }: ShareCardProps) {
  const id = useId();
  return (
    <section className="ps-share" aria-labelledby={id}>
      <h3 id={id} data-ui="title">
        {title}
      </h3>
      <p>{text}</p>
      {action}
    </section>
  );
}
