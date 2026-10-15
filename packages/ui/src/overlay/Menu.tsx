/**
 * @component Menu
 * @group Overlays
 * @summary A short list of actions behind one button (the ⋮ on a record, the + in a composer, the account menu).
 * @use Secondary actions on a record or a row, choices behind a split button (Schedule). Items are Verb Noun; destructive ones are red and come last.
 * @avoid The main action (a Button of its own); choosing a value in a form (SelectField); navigation between pages (links); more than about 8 items.
 * @phone An action sheet from the bottom: large rows, destructive items in red, Cancel at the foot.
 * @a11y Radix menu on desktop: arrow keys move, Enter chooses, typing jumps to an item, Esc closes and focus returns to the button. The button needs a name (an IconButton label).
 * @status stable
 * @example <Menu trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} items={[{ label: "Archive", icon: "book", onSelect: archive }, "sep", { label: "Move to Trash", icon: "x", danger: true, onSelect: trash }]} />
 */
import { useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import * as Radix from "@radix-ui/react-dropdown-menu";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon, type IconName } from "../icons/Icon";
import { Button } from "../actions/Button";
import { Sheet } from "./Sheet";

/** One action in a menu, or "sep" for a divider between groups. */
export type MenuItem =
  | {
      /** Verb Noun, Title Case: "Move to Inbox". */
      label: ReactNode;
      /** A glyph before the label. */
      icon?: IconName;
      /** What the item does. Runs after the menu has closed, so it may open a modal. */
      onSelect: () => void;
      /** Destructive: drawn in red (confirm it with useConfirm). */
      danger?: boolean;
      /** Shown but not choosable. */
      disabled?: boolean;
    }
  | "sep";

/** What the trigger function receives; spread it onto the button. */
export interface MenuTriggerProps {
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "menu";
  ref: Ref<HTMLButtonElement>;
}

export interface MenuProps {
  /** The button that opens it: a function that spreads the props it is given onto a button, or the button itself. */
  trigger: ((props: MenuTriggerProps) => ReactNode) | ReactElement;
  /** The actions, top to bottom; "sep" draws a divider. */
  items: MenuItem[];
  /** Which edge of the button the menu lines up with on desktop. Default `end`. */
  align?: "start" | "end";
  /** Names the action sheet on a phone for screen readers. Default "Actions". */
  label?: string;
  /** Where it mounts; document.body by default. */
  container?: HTMLElement | null;
}

const ROW = "flex w-full items-center gap-2.5 rounded-box px-3 text-left outline-none select-none";

export function Menu({ trigger, items, align = "end", label = "Actions", container }: MenuProps) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);

  // An item's action runs once the menu has closed and focus is back on the button,
  // so a modal it opens finds the right opener and its own focus is not taken back.
  const run = () => {
    const act = pending.current;
    pending.current = null;
    if (act) setTimeout(act, 0);
  };
  const choose = (act: () => void) => {
    pending.current = act;
    setOpen(false);
  };

  const triggerProps: MenuTriggerProps = {
    onClick: phone ? () => setOpen((o) => !o) : () => undefined,
    "aria-expanded": open,
    "aria-haspopup": "menu",
    ref: button,
  };
  const triggerEl = typeof trigger === "function" ? trigger(triggerProps) : <Slot {...triggerProps}>{trigger}</Slot>;

  if (phone) {
    return (
      <>
        {triggerEl}
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          hideHeader
          container={container}
          bodyClassName="px-2 pt-1 pb-2"
        >
          <ul className="flex flex-col">
            {items.map((it, i) =>
              it === "sep" ? (
                <li key={i} aria-hidden="true" className="mx-3 my-1 h-px bg-border" />
              ) : (
                <li key={i}>
                  <button
                    type="button"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(false);
                      setTimeout(it.onSelect, 0);
                    }}
                    className={cn(ROW, "min-h-tap text-base hover:bg-muted active:bg-muted disabled:opacity-40", it.danger && "text-destructive")}
                  >
                    {it.icon && <Icon name={it.icon} size="m" className={it.danger ? undefined : "text-muted-foreground"} />}
                    {it.label}
                  </button>
                </li>
              ),
            )}
          </ul>
          <Button block className="mt-2" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </Sheet>
      </>
    );
  }

  return (
    <Radix.Root open={open} onOpenChange={setOpen}>
      <Radix.Trigger asChild>{triggerEl as ReactElement}</Radix.Trigger>
      <Radix.Portal container={container ?? undefined}>
        <Radix.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={run}
          className="z-50 min-w-52 animate-rise rounded-box border border-border bg-popover p-1.5 text-popover-foreground shadow-3 outline-none"
        >
          {items.map((it, i) =>
            it === "sep" ? (
              <Radix.Separator key={i} className="mx-1 my-1 h-px bg-border" />
            ) : (
              <Radix.Item
                key={i}
                disabled={it.disabled}
                onSelect={() => choose(it.onSelect)}
                className={cn(
                  ROW,
                  "h-control text-sm data-disabled:opacity-40 data-highlighted:bg-muted",
                  it.danger ? "text-destructive data-highlighted:bg-destructive-soft" : "text-foreground",
                )}
              >
                {it.icon && <Icon name={it.icon} className={it.danger ? undefined : "text-muted-foreground"} />}
                {it.label}
              </Radix.Item>
            ),
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
