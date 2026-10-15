/**
 * toast(): a short confirmation after an action ("Rule created"), shown by the
 * Toaster mounted once in each app. Never a native alert (gate 16), never a
 * field error (those sit on the field, FRONTEND_GUIDE §8.3).
 *
 *   toast("Rule created")                          the merged call shape: a success
 *   toast.success("Leave approved")
 *   toast.error("Could not save the draft")
 *   toast.info("Mailbox up to date")
 *   toast("Alert cleared", { undo: () => restore() })   with an Undo action
 *
 * At most 8 words, sentence case (§5.3); development warns past that.
 */
import { toast as sonner, type ExternalToast } from "sonner";
import { WORD_LIMITS, warnOverLimit } from "../help/words";

/** What a toast may carry beyond its text. */
export interface ToastOptions {
  /** Adds an Undo action that calls this; the toast stays longer so it can be reached. */
  undo?: () => void;
  /** Another single action instead of Undo (Verb Noun, at most 3 words). */
  action?: { label: string; onClick: () => void };
  /** How long it shows, in ms. 4 s by default; 6 s with an action or for an error. */
  duration?: number;
  /** Replaces a showing toast with the same id instead of stacking another. */
  id?: string | number;
  /** The Toaster to show it in, when a page mounts more than one (the gallery). */
  toasterId?: string;
}

type Kind = "success" | "error" | "info";

/** Shows one toast and returns its id. */
export type ShowToast = (text: string, options?: ToastOptions) => string | number;

/** toast(text) and its kinds. */
export interface ToastApi extends ShowToast {
  /** Something worked (the default look, as `toast(text)`). */
  success: ShowToast;
  /** Something did not work; one line, no stack, no code. */
  error: ShowToast;
  /** News that is neither (Mailbox up to date). */
  info: ShowToast;
  /** Removes one toast, or all of them. */
  dismiss: (id?: string | number) => void;
}

function show(kind: Kind, text: string, o: ToastOptions = {}): string | number {
  warnOverLimit("Toast", text, WORD_LIMITS.toast);
  const action = o.undo ? { label: "Undo", onClick: o.undo } : o.action;
  const data: ExternalToast = {
    id: o.id,
    toasterId: o.toasterId,
    duration: o.duration ?? (action || kind === "error" ? 6000 : 4000),
    action: action && { label: action.label, onClick: () => action.onClick() },
  };
  return sonner[kind](text, data);
}

export const toast: ToastApi = Object.assign((text: string, options?: ToastOptions) => show("success", text, options), {
  success: (text: string, options?: ToastOptions) => show("success", text, options),
  error: (text: string, options?: ToastOptions) => show("error", text, options),
  info: (text: string, options?: ToastOptions) => show("info", text, options),
  dismiss: (id?: string | number) => {
    sonner.dismiss(id);
  },
});
