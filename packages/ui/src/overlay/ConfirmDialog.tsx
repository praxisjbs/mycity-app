/**
 * @component ConfirmDialog
 * @group Overlays
 * @summary A yes or no before an action that cannot be taken back, named for the thing it acts on ("Delete Rule").
 * @use Deleting, cancelling, revoking, emptying a folder: `if (!(await confirm({ title: "Delete Rule", destructive: true }))) return;`. The component form when a screen keeps its own state.
 * @avoid Asking before something that can be undone (do it, and offer Undo in the toast); window.confirm (gate 16); a form (use Modal).
 * @phone A short bottom sheet; the confirm button full width at the bottom, Cancel above it.
 * @a11y An alertdialog: Cancel has focus when it opens, Esc and the close button answer no. A destructive confirmation cannot be dismissed by a stray tap on the scrim. While an async confirm runs, Cancel, Esc and the close button wait (F26).
 * @status stable
 * @example const confirm = useConfirm(); if (await confirm({ title: "Delete Rule", destructive: true })) remove(rule);
 * @example <ConfirmDialog open={open} title="Revoke Device" destructive onConfirm={revoke} onCancel={() => setOpen(false)} />
 */
import { useCallback, useContext, type ReactNode } from "react";
import { Button } from "../actions/Button";
import { Modal } from "./Modal";
import { HostContext } from "./context";

export interface ConfirmDialogProps {
  /** Whether it is showing. */
  open: boolean;
  /** The action and the thing, Verb Noun, at most 4 words: "Delete Rule", "Empty Trash". */
  title: string;
  /** At most one sentence of 20 words on what follows, only when the title does not say it. */
  body?: ReactNode;
  /** The confirm button, Verb Noun; the title by default. */
  confirmLabel?: string;
  /** The way out. Default "Cancel". */
  cancelLabel?: string;
  /** A red confirm button, and the scrim no longer dismisses. */
  destructive?: boolean;
  /** Whether Esc and the scrim answer no. Default: true unless destructive. */
  dismissible?: boolean;
  /** Called on confirm. A promise keeps the button busy until it settles. */
  onConfirm: () => void | Promise<unknown>;
  /** Called on Cancel, Esc, the close button, or (when dismissible) the scrim. */
  onCancel: () => void;
  /** Where it mounts; document.body by default. */
  container?: HTMLElement | null;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  dismissible,
  onConfirm,
  onCancel,
  container,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      dismissible={dismissible ?? !destructive}
      container={container}
      footer={
        <>
          <Button data-autofocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={() => onConfirm()}>
            {confirmLabel ?? title}
          </Button>
        </>
      }
    >
      {body ? <p className="text-body text-muted-foreground">{body}</p> : null}
    </Modal>
  );
}

/** What `confirm()` takes: ConfirmDialog's wording. */
export interface ConfirmOptions {
  /** The action and the thing, Verb Noun, at most 4 words: "Delete Rule". */
  title: string;
  /** At most one sentence on what follows. */
  body?: ReactNode;
  /** The confirm button; the title by default. */
  confirmLabel?: string;
  /** The way out. Default "Cancel". */
  cancelLabel?: string;
  /** Red, and not dismissed by the scrim. */
  destructive?: boolean;
  /** Whether Esc and the scrim answer no. Default: true unless destructive. */
  dismissible?: boolean;
}

/**
 * `const confirm = useConfirm(); if (!(await confirm({ title: "Delete Rule", destructive: true }))) return;`
 * The promise resolves true on confirm and false on every other way out, also when a second
 * confirmation replaces it, the route changes or the app unmounts, so an `await` never hangs.
 * Shows above an open modal. Needs ModalProvider around the app.
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const host = useContext(HostContext);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (!host) throw new Error("useConfirm needs ModalProvider around the app");
        let done = false;
        const settle = (ok: boolean) => {
          if (done) return;
          done = true;
          host.hide();
          resolve(ok);
        };
        host.show({
          render: (open) => <ConfirmDialog {...options} open={open} onConfirm={() => settle(true)} onCancel={() => settle(false)} />,
          onDrop: () => {
            done = true;
            resolve(false);
          },
        });
      }),
    [host],
  );
  if (!host) throw new Error("useConfirm needs ModalProvider around the app");
  return confirm;
}
