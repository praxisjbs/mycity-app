/**
 * @component Form
 * @group Forms
 * @summary The one <form>: Enter submits, the browser's own bubbles are off; with FormFooter, the buttons at its foot.
 * @use Around every set of fields; onSubmit comes from the form hook (form.submit(save) or a handler that calls form.check()).
 * @avoid A <form> written anywhere else (gate 12); text in a footer (buttons only); a disabled submit button.
 * @phone FormFooter puts the primary button full width at the bottom and the others above it.
 * @a11y A real form element, so Enter submits and assistive technology announces it; FormFooter keeps the primary last in the tab order.
 * @status stable
 * @exports FormFooter
 * @example <Form onSubmit={form.submit(save)}>…<FormFooter><Button>Cancel</Button><Button variant="primary" type="submit">Create Rule</Button></FormFooter></Form>
 */
import type { FormEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface FormProps {
  /** Called on submit (Enter in a single-line form, or the submit button). */
  onSubmit: () => void;
  /** The fields and the footer. */
  children: ReactNode;
  /** Layout classes only. */
  className?: string;
  /** Its id, so a button outside it (a modal footer) can submit it with form={id}. */
  id?: string;
}

export function Form({ onSubmit, children, className, id }: FormProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form id={id} className={className} noValidate onSubmit={submit}>
      {children}
    </form>
  );
}

export interface FormFooterProps {
  /** Buttons only: Cancel first, the primary (Verb Noun, the only filled one) last. */
  children: ReactNode;
  /** Layout classes only. */
  className?: string;
}

/** Buttons only. Desktop: Cancel left, the primary right. Phone: the primary full width at the bottom. */
export function FormFooter({ children, className }: FormFooterProps) {
  return (
    <div data-ui="form-footer" className={cn("mt-4 flex flex-col-reverse gap-2 desk:flex-row desk:justify-end phone:[&>*]:w-full", className)}>
      {children}
    </div>
  );
}
