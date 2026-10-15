/**
 * The option shapes Chips and SegmentedControl take: the merged tuple
 * (`["late", "Late"]`, which every screen passes today) or an object that can
 * also carry a count, an icon or a disabled flag.
 */
import type { ReactNode } from "react";
import type { IconName } from "../icons/Icon";

/** One choice, as the object form. */
export interface ChoiceOption<V extends string> {
  /** What onChange receives. */
  value: V;
  /** What the person reads: Title Case, at most 3 words. */
  label: ReactNode;
  /** A count shown beside the label (Late 4); pass the number, not a label with it baked in. */
  count?: number;
  /** A glyph before the label. */
  icon?: IconName;
  /** Shown but not choosable. */
  disabled?: boolean;
}

/** The merged tuple or the object form. */
export type Choice<V extends string> = readonly [V, ReactNode] | ChoiceOption<V>;

/** Either shape, as the object form. */
export function toOption<V extends string>(choice: Choice<V>): ChoiceOption<V> {
  if (Array.isArray(choice)) {
    const [value, label] = choice as readonly [V, ReactNode];
    return { value, label };
  }
  return choice as ChoiceOption<V>;
}
