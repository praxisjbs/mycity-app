/**
 * @component ActionGroup
 * @group Actions
 * @summary Buttons that wait for each other: while one is working, the others in the group dim and ignore presses until it finishes.
 * @use Around buttons that act on the same thing and must not race: Approve and Reject on a request row, Retire and Edit on a record. Modals, forms, form footers, card headers, page headers and shell notices are groups already.
 * @avoid Around a whole page or list (one slow request would hold every row); around a single button (it already ignores a second press); for layout (it draws no element).
 * @phone The same: the waiting buttons dim and keep their 44 px targets.
 * @a11y Draws no element of its own. A busy button says aria-busy; the waiting ones say aria-disabled, so a screen reader hears them as unavailable while they stay focusable.
 * @status stable
 * @example <ActionGroup><Button onClick={reject}>Reject</Button><Button variant="primary" onClick={approve}>Approve</Button></ActionGroup>
 */
import type { ReactNode } from "react";
import { PressGroupContext, usePressGroup } from "./press";

export interface ActionGroupProps {
  /** The buttons, laid out by the caller: the group adds behaviour, not markup. */
  children?: ReactNode;
}

export function ActionGroup({ children }: ActionGroupProps) {
  const group = usePressGroup();
  return <PressGroupContext.Provider value={group}>{children}</PressGroupContext.Provider>;
}
