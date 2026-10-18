/**
 * @component Form
 * @group Forms
 * @summary The one <form>: Enter submits, the browser's own bubbles are off, and a save it is waiting on cannot be sent twice; with FormFooter, the buttons at its foot.
 * @use Around every set of fields; onSubmit comes from the form hook (form.submit(save) or a handler that calls form.check()). Return the save's promise and the form refuses another submit until it settles, its submit button spins and its other buttons wait (F26).
 * @avoid A <form> written anywhere else (gate 12); text in a footer (buttons only); a disabled submit button.
 * @phone FormFooter puts the primary button full width at the bottom and the others above it.
 * @a11y A real form element, so Enter submits and assistive technology announces it; FormFooter keeps the primary last in the tab order. While a save runs the submit button says aria-busy and stays focusable.
 * @status stable
 * @exports FormFooter
 * @example <Form onSubmit={form.submit(save)}>…<FormFooter><Button>Cancel</Button><Button variant="primary" type="submit">Create Rule</Button></FormFooter></Form>
 */
import { useRef, type FormEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { ActionGroup } from "../actions/ActionGroup";
import { isThenable, markSubmitting, PressGroupContext, submitterOf, usePressGroup, whenSettled } from "../actions/press";

export interface FormProps {
  /** Called on submit (Enter in a single-line form, or the submit button). Return the save's promise to hold the form until it settles. */
  onSubmit: () => unknown;
  /** The fields and the footer. */
  children: ReactNode;
  /** Layout classes only. */
  className?: string;
  /** Its id, so a button outside it (a modal footer) can submit it with form={id}. */
  id?: string;
}

export function Form({ onSubmit, children, className, id }: FormProps) {
  const group = usePressGroup();
  const working = useRef(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Enter pressed twice, or a submit while another button in the form is working: one save at a time.
    if (working.current || group.isBusy()) return;
    const out = onSubmit();
    if (!isThenable(out)) return;
    working.current = true;
    const end = group.begin();
    const unmark = markSubmitting(submitterOf(e.currentTarget, e.nativeEvent));
    whenSettled(out, () => {
      working.current = false;
      unmark();
      end();
    });
  };
  return (
    <PressGroupContext.Provider value={group}>
      <form id={id} className={className} noValidate onSubmit={submit}>
        {children}
      </form>
    </PressGroupContext.Provider>
  );
}

export interface FormFooterProps {
  /** Buttons only: Cancel first, the primary (Verb Noun, the only filled one) last. */
  children: ReactNode;
  /** Layout classes only. */
  className?: string;
}

/** Buttons only. Desktop: Cancel left, the primary right. Phone: the primary full width at the bottom. Its buttons wait for each other (F26). */
export function FormFooter({ children, className }: FormFooterProps) {
  return (
    <div data-ui="form-footer" className={cn("mt-4 flex flex-col-reverse gap-2 desk:flex-row desk:flex-wrap desk:justify-end phone:[&>*]:w-full", className)}>
      <ActionGroup>{children}</ActionGroup>
    </div>
  );
}
