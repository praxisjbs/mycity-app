/**
 * @component Form
 * @group Forms
 * @summary The one <form>: Enter submits, the browser's own bubbles are off, and a save it is waiting on cannot be sent twice; with FormFooter, the buttons at its foot.
 * @use Around every set of fields; onSubmit comes from the form hook (form.submit(save) or a handler that calls form.check()). Return the save's promise and the form refuses another submit until it settles, its submit button spins and its other buttons wait (F26).
 * @avoid A <form> written anywhere else (gate 12); text in a footer (buttons only); a disabled submit button.
 * @phone In a sheet (a Modal, SidePanel or Sheet on a phone) FormFooter pins its buttons in the sheet's own footer, as ModalFooter does, so Save is in thumb reach however long the form: full width, the primary at the bottom and the others above it, still one group (F26). On a page they sit full width at the form's foot. Desktop is unchanged: the buttons sit at the form's foot.
 * @a11y A real form element, so Enter submits and assistive technology announces it; FormFooter keeps the primary last in the tab order. Pinned to a sheet's footer, its submit button names the form with form=, so pressing it or Enter in a field still submits it. While a save runs the submit button says aria-busy and stays focusable.
 * @status stable
 * @exports FormFooter
 * @example <Form onSubmit={form.submit(save)}>…<FormFooter><Button>Cancel</Button><Button variant="primary" type="submit">Create Rule</Button></FormFooter></Form>
 */
import { createContext, useContext, useId, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { ActionGroup } from "../actions/ActionGroup";
import { isThenable, markSubmitting, PressGroupContext, SubmitOwnerContext, submitterOf, usePressGroup, whenSettled } from "../actions/press";
import { FooterContext, IN_FOOTER } from "../overlay/context";

/** The id of the form around a FormFooter, so its buttons can name it when they are pinned outside it. */
const FormIdContext = createContext<string | undefined>(undefined);

export interface FormProps {
  /** Called on submit (Enter in a single-line form, or the submit button). Return the save's promise to hold the form until it settles. */
  onSubmit: () => unknown;
  /** The fields and the footer. */
  children: ReactNode;
  /** Layout classes only. */
  className?: string;
  /** Its id, so a button outside it (a modal footer) can submit it with form={id}. */
  id?: string;
  /** `search` for a form that is a search box (SiteSearch), so it is a search landmark. */
  role?: "search";
}

export function Form({ onSubmit, children, className, id, role }: FormProps) {
  const auto = useId();
  const formId = id ?? auto;
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
      <FormIdContext.Provider value={formId}>
        <form id={formId} role={role} className={className} noValidate onSubmit={submit}>
          {children}
        </form>
      </FormIdContext.Provider>
    </PressGroupContext.Provider>
  );
}

export interface FormFooterProps {
  /** Buttons only: Cancel first, the primary (Verb Noun, the only filled one) last. */
  children: ReactNode;
  /** Layout classes only, for the footer at the form's foot (on a phone sheet the buttons sit in the sheet's footer instead). */
  className?: string;
}

/**
 * Buttons only. Desktop: Cancel left, the primary right, at the form's foot. Phone: the primary
 * full width at the bottom; inside a sheet the buttons are pinned in the sheet's footer, out of
 * the scrolling body, as ModalFooter's are. Its buttons wait for each other (F26).
 */
export function FormFooter({ children, className }: FormFooterProps) {
  const phone = useIsPhone();
  const slot = useContext(FooterContext);
  const formId = useContext(FormIdContext);
  // A phone sheet (Modal, SidePanel or Sheet) has a footer that never scrolls away: the buttons go there.
  if (phone && slot.inOverlay && !slot.inFooter) {
    if (!slot.target) return null;
    return createPortal(
      <FooterContext.Provider value={IN_FOOTER}>
        <SubmitOwnerContext.Provider value={formId}>
          <div data-ui="form-footer" data-pinned="" className="contents">
            <ActionGroup>{children}</ActionGroup>
          </div>
        </SubmitOwnerContext.Provider>
      </FooterContext.Provider>,
      slot.target,
    );
  }
  return (
    <div data-ui="form-footer" className={cn("mt-4 flex flex-col-reverse gap-2 desk:flex-row desk:flex-wrap desk:justify-end phone:[&>*]:w-full", className)}>
      <ActionGroup>{children}</ActionGroup>
    </div>
  );
}
