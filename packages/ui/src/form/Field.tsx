/**
 * @component Field
 * @group Forms
 * @summary A form field's frame: the label above, an Optional tag, the control, and the error on the field as it is filled.
 * @use Around every control in a form: TextField, DateField, MoneyField, SelectField and the rest take their ids from it.
 * @avoid A hint sentence under the field (the control shows its own format; a label that needs explaining is a help term); an asterisk; a field built by hand.
 * @phone One column; labels stay above; the control is 44 px tall with 16 px text.
 * @a11y The label names the control (or, with help, labels it by id beside the help term); the error is linked by aria-describedby and announced politely.
 * @status stable
 * @exports FormRow, FormError
 * @example <Field label="Work Email" {...form.status("work_email")}><TextField type="email" {...form.field("work_email")} /></Field>
 */
import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { describedBy, useControlIds, type ControlIds } from "../lib/ids";
import { Icon } from "../icons/Icon";
import { HelpTerm } from "../help/HelpTerm";
import type { FieldState } from "./binding";

interface FieldContextValue extends ControlIds {
  state: FieldState;
  /** True when the label is a help term: the control is labelled by id, not by <label for>. */
  labelledBy: boolean;
  hasHelp: boolean;
  hasError: boolean;
  /** The field carries the Optional tag: it may be left empty. */
  optional: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * The ids and aria attributes a control inside a Field takes. Used by the controls in this folder.
 * A group (a radio group) is not named by a <label for>, so with `group` it is always labelled by id.
 */
export function useFieldControl(own: { id?: string; state?: FieldState; group?: boolean }) {
  const ctx = useContext(FieldContext);
  const state = own.state ?? ctx?.state;
  return {
    id: own.id ?? ctx?.id,
    state,
    "aria-labelledby": ctx && (ctx.labelledBy || own.group) ? ctx.labelId : undefined,
    "aria-describedby": ctx ? describedBy(ctx.hasHelp && ctx.helpId, ctx.hasError && ctx.errorId) : undefined,
    "aria-invalid": state === "bad" || undefined,
  };
}

/** The id of the Field's label, so a control that opens a sheet can title it with the label's words. */
export function useFieldLabelId(): string | undefined {
  return useContext(FieldContext)?.labelId;
}

/** Whether the Field around a control carries the Optional tag, so the control can offer to clear itself. */
export function useFieldOptional(): boolean {
  return useContext(FieldContext)?.optional ?? false;
}

export interface FieldProps {
  /** Title Case, at most 4 words. */
  label: ReactNode;
  /** Support text behind the label as a help term (one or two sentences, at most 35 words). */
  help?: ReactNode;
  /** The merged name for `help`; kept so screens move by an import change. */
  info?: ReactNode;
  /** Shows the Optional tag. A field with no tag is required. */
  optional?: boolean;
  /** The mark, from the form hook's status(name). */
  state?: FieldState;
  /** The error, at most 4 words, shown when the state is bad. */
  message?: ReactNode;
  /** The control. */
  children: ReactNode;
  /** The control's id, when the caller sets it; one is made otherwise. */
  htmlFor?: string;
  /** Layout classes only. */
  className?: string;
}

export function Field({ label, help, info, optional, state, message, children, htmlFor, className }: FieldProps) {
  const ids = useControlIds(typeof label === "string" ? label.toLowerCase() : "field");
  const id = htmlFor ?? ids.id;
  const helpText = help ?? info;
  const hasError = state === "bad" && !!message;
  const ctx: FieldContextValue = { ...ids, id, state, labelledBy: !!helpText, hasHelp: !!helpText, hasError, optional: !!optional };
  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn("mb-3.5", className)} data-state={state}>
        <div className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold text-muted-foreground">
          {helpText ? (
            <span id={ids.labelId}>
              <HelpTerm help={helpText} helpId={ids.helpId}>
                {label}
              </HelpTerm>
            </span>
          ) : (
            <label id={ids.labelId} htmlFor={id}>
              {label}
            </label>
          )}
          {optional && <span className="text-2xs font-medium text-subtle-foreground">Optional</span>}
        </div>
        {children}
        <p id={ids.errorId} aria-live="polite" className={cn("mt-1 items-center gap-1 text-xs text-destructive", hasError ? "flex" : "hidden")}>
          {hasError && (
            <>
              <Icon name="alert" size="s" />
              <span>{message}</span>
            </>
          )}
        </p>
      </div>
    </FieldContext.Provider>
  );
}

export interface FormRowProps {
  /** Two fields: side by side on desktop, stacked on a phone. */
  children: ReactNode;
}

/** Two fields side by side on desktop, stacked on a phone. */
export function FormRow({ children }: FormRowProps) {
  return <div className="grid grid-cols-1 gap-x-2.5 desk:grid-cols-2">{children}</div>;
}

export interface FormErrorProps {
  /** One line: what failed that is not one field's fault (the server was unreachable). Nothing renders when empty. */
  children?: ReactNode;
}

/** The one general error line, above the footer; a field's own error stays on the field. */
export function FormError({ children }: FormErrorProps) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-3 flex items-center gap-1.5 text-sm text-destructive">
      <Icon name="alert" size="s" />
      <span>{children}</span>
    </p>
  );
}
