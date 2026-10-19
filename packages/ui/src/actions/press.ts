/**
 * One press, one request (FRONTEND_FOUNDATION F26). What Button, IconButton,
 * BigButton and Form share:
 *
 *   usePress     a press handler that returns a promise makes its button busy
 *                from that moment until the promise settles. A second press is
 *                refused at once, through a ref, before React draws the spinner,
 *                so a double click or a double tap never sends the work twice.
 *   groups       the buttons around a busy one wait with it (ActionGroup; every
 *                modal, form, form footer, card header, page header and shell
 *                notice is one), so Approve cannot race Reject and Cancel cannot
 *                close a dialog mid-save. A modal starts a group of its own: a
 *                confirmation opened by a busy button stays answerable.
 *   submitters   a <Form> whose onSubmit returns a promise marks the button that
 *                submitted it busy, even one outside it that names it with form=.
 *
 * A busy button stays focusable and named (aria-busy, aria-disabled), never
 * `disabled`: Submit is never disabled (FRONTEND_GUIDE §8.3).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ForwardedRef,
  type RefObject,
} from "react";

/** Whether a press handler handed back work to wait for. */
export const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && (typeof v === "object" || typeof v === "function") && typeof (v as PromiseLike<unknown>).then === "function";

/**
 * Runs `done` once the work settles, either way. A failure the handler did not
 * catch itself is logged, as an uncaught one was before the button watched it,
 * so it still reaches the console instead of vanishing here.
 */
export function whenSettled(work: PromiseLike<unknown>, done: () => void): void {
  void Promise.resolve(work).then(done, (error: unknown) => {
    done();
    console.error(error);
  });
}

export interface PressGroup {
  /** Whether a press in this group, or in a group around it, is still working. */
  busy: boolean;
  /** The same, read at the moment of a press, before React has drawn the last change. */
  isBusy: () => boolean;
  /** Marks the start of some work in the group; the function it returns marks the end (once). */
  begin: () => () => void;
}

export const PressGroupContext = createContext<PressGroup | null>(null);

/**
 * A group's state. Work begun in it also holds the group around it, so a form
 * in a modal keeps the modal's close button waiting. `isolated` starts a fresh
 * group with nothing around it: an overlay, which sits above the busy page.
 */
export function usePressGroup(isolated = false): PressGroup {
  const around = useContext(PressGroupContext);
  const parent = isolated ? null : around;
  const parentRef = useRef(parent);
  useLayoutEffect(() => {
    parentRef.current = parent;
  });
  const count = useRef(0);
  const [working, setWorking] = useState(false);

  const begin = useCallback(() => {
    count.current += 1;
    setWorking(true);
    const endAround = parentRef.current?.begin();
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      count.current -= 1;
      setWorking(count.current > 0);
      endAround?.();
    };
  }, []);
  const isBusy = useCallback(() => count.current > 0 || !!parentRef.current?.isBusy(), []);
  const busy = working || !!parent?.busy;
  return useMemo(() => ({ busy, isBusy, begin }), [busy, isBusy, begin]);
}

/* ------------------------------------------------------------------ *
 * Form submitters: which buttons a working <Form> was submitted by
 * ------------------------------------------------------------------ */

const submitting = new Set<Element>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Marks a form's submit button busy until the function it returns is called. */
export function markSubmitting(el: Element | null): () => void {
  if (!el) return () => undefined;
  submitting.add(el);
  emit();
  return () => {
    submitting.delete(el);
    emit();
  };
}

/** Whether this button submitted a form that is still working. */
function useSubmitting(ref: RefObject<Element | null>): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!ref.current && submitting.has(ref.current),
    () => false,
  );
}

/** The button a form was submitted by: the one pressed, or its first submit button for Enter. */
export function submitterOf(form: HTMLFormElement, event: Event): Element | null {
  const pressed = (event as Event & { submitter?: Element | null }).submitter;
  if (pressed) return pressed;
  // form.elements also holds the buttons outside it that name it with form=, such as a modal's footer.
  return Array.from(form.elements).find((el) => el instanceof HTMLButtonElement && el.type === "submit") ?? null;
}

/* ------------------------------------------------------------------ *
 * usePress: one button's busy and waiting state
 * ------------------------------------------------------------------ */

export interface Press<E extends { preventDefault: () => void }> {
  /** Spinning: its own work, a form it submitted, or the busy it was given. */
  busy: boolean;
  /** Another button in its group is working; this one ignores presses meanwhile. */
  waiting: boolean;
  /** The click handler: refuses a press while busy or waiting, else runs the handler and watches what it returns. */
  press: (e: E) => void;
}

/**
 * @param onPress the button's own handler; a promise it returns is the work
 * @param busyProp a busy the caller manages (a mutation's pending); it holds the group too
 * @param ref the button's element, to find it among a working form's submitters
 */
export function usePress<E extends { preventDefault: () => void }>(
  onPress: ((e: E) => unknown) | undefined,
  busyProp: boolean | undefined,
  ref: RefObject<Element | null>,
): Press<E> {
  const group = useContext(PressGroupContext);
  const working = useRef(false);
  const [own, setOwn] = useState(false);
  const submitted = useSubmitting(ref);
  const begin = group?.begin;

  // A busy the caller sets (busy={save.pending}) holds the group as well.
  useEffect(() => {
    if (!busyProp || !begin) return;
    return begin();
  }, [busyProp, begin]);

  const busy = !!busyProp || own || submitted;
  const waiting = !busy && !!group?.busy;

  const press = (e: E) => {
    if (working.current || busy || group?.isBusy() || (ref.current && submitting.has(ref.current))) {
      e.preventDefault();
      return;
    }
    const out = onPress?.(e);
    if (!isThenable(out)) return;
    working.current = true;
    setOwn(true);
    const end = group?.begin();
    whenSettled(out, () => {
      working.current = false;
      setOwn(false);
      end?.();
    });
  };

  return { busy, waiting, press };
}

/** The button's own handle on its element, for usePress, while the caller's ref still receives it. */
export function useElementRef<T>(forwarded: ForwardedRef<T>): [RefObject<T | null>, (node: T | null) => void] {
  const own = useRef<T | null>(null);
  const set = useCallback(
    (node: T | null) => {
      own.current = node;
      if (typeof forwarded === "function") forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [forwarded],
  );
  return [own, set];
}

/** The attribute the buttons style from: `data-press="busy"` spins, `"waiting"` dims. */
export const pressState = ({ busy, waiting }: { busy: boolean; waiting: boolean }) =>
  busy ? "busy" : waiting ? "waiting" : undefined;
