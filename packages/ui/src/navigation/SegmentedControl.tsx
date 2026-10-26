/**
 * @component SegmentedControl
 * @group Navigation
 * @summary Two to five views of the same thing side by side in one pill (Mine, My Team; Week, Month), one of them on.
 * @use Switching what a list, board or chart shows, in a toolbar or a page header; at most 5 options, each at most 3 words.
 * @avoid A choice inside a form (use ChoiceField); filtering a list by status with counts (use Chips); the module's views (use Tabs); more than 5 options (use a select or Tabs).
 * @phone Fills the width with equal segments, each a 44 px target; a long set scrolls sideways inside itself, never the page.
 * @a11y A radiogroup named by `label`, each segment a radio: one Tab stop, the arrow keys move and choose, Home and End go to the ends.
 * @status stable
 * @example <SegmentedControl label="Whose Tasks" value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />
 */
import { useRef, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { WORD_LIMITS, warnOverLimit } from "../help/words";
import { CountBadge } from "../display/CountBadge";
import { toOption, unreadOf, type Choice } from "./options";

export interface SegmentedControlProps<V extends string = string> {
  /** The view showing. */
  value: V;
  /** Called with the chosen view. */
  onChange: (value: V) => void;
  /** Two to five options: the merged tuple ["team", "My Team"], or { value, label, icon, count, unread, urgent, disabled }; `unread` the reader's unread notifications behind a view, in yellow. */
  options: ReadonlyArray<Choice<V>>;
  /** Names the group for assistive technology ("Whose Tasks"); give one unless a visible label sits beside it. */
  label?: string;
  /** Values shown but not choosable (the merged Seg's `disabled`). */
  disabled?: readonly V[];
  /** The 28 px desktop size for a dense toolbar (still 44 px on a phone). */
  small?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function SegmentedControl<V extends string = string>({ value, onChange, options, label, disabled, small, className }: SegmentedControlProps<V>) {
  const items = options.map(toOption);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  if (import.meta.env.DEV && items.length > 5) console.warn(`SegmentedControl has ${items.length} options (at most 5, FRONTEND_GUIDE §8.2); use Tabs or a select.`);
  for (const item of items) warnOverLimit("Segment", item.label, WORD_LIMITS.button);

  const off = (i: number) => !!items[i]?.disabled || !!disabled?.includes(items[i]?.value as V);
  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    refs.current[i]?.focus();
    if (item.value !== value) onChange(item.value);
  };
  const move = (from: number, step: number) => {
    for (let n = 1; n <= items.length; n++) {
      const i = (from + step * n + items.length * n) % items.length;
      if (!off(i)) return choose(i);
    }
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(i, 1),
      ArrowDown: () => move(i, 1),
      ArrowLeft: () => move(i, -1),
      ArrowUp: () => move(i, -1),
      Home: () => move(-1, 1),
      End: () => move(items.length, -1),
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  };
  const current = items.findIndex((o) => o.value === value);
  const stop = current >= 0 ? current : items.findIndex((_, i) => !off(i));

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "no-scrollbar inline-flex max-w-full items-center overflow-x-auto rounded-full border border-input bg-background p-0.5 phone:flex phone:w-full",
        className,
      )}
    >
      {items.map((item, i) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off(i)}
            tabIndex={i === stop ? 0 : -1}
            data-ui="button"
            onClick={() => choose(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex flex-none items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors duration-(--dur-fast) disabled:opacity-40 phone:min-h-tap phone:flex-1",
              small ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
              on ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
            {item.count != null && " "}
            {item.count != null && <span className="text-xs tabular-nums">{item.count}</span>}
            {unreadOf(item) > 0 && " "}
            <CountBadge count={unreadOf(item)} tone={item.urgent ? "err" : "primary"} label="unread" />
          </button>
        );
      })}
    </div>
  );
}
