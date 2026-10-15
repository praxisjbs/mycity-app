/**
 * Element ids that tie a control to its label, help text and error, so a
 * screen reader reads them together (aria-labelledby, aria-describedby,
 * aria-errormessage). React's useId keeps them unique on the page and equal
 * between server and client renders.
 */
import { useId } from "react";

/** The ids of one control and the parts that describe it. */
export interface ControlIds {
  /** The control itself (the input, the trigger, the dialog). */
  id: string;
  /** Its visible label or title. */
  labelId: string;
  /** Its help text (a HelpTerm or a hint under the field). */
  helpId: string;
  /** Its error message. */
  errorId: string;
}

/** The ids for one control, from a readable stem (the field name) and a page-unique suffix. */
export function useControlIds(stem = "ctl"): ControlIds {
  const unique = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const base = `${stem.replace(/[^A-Za-z0-9_-]/g, "-")}-${unique}`;
  return { id: base, labelId: `${base}-label`, helpId: `${base}-help`, errorId: `${base}-error` };
}

/** A space-separated id list for aria-describedby, skipping the parts not shown; undefined when none are. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const list = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
  return list.length ? list.join(" ") : undefined;
}
