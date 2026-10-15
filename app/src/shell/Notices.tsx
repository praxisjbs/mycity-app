import { useCallback } from "react";
import { Button, Icon, ShellNotice, useModal } from "@mycity/ui";
import { install, installLater, usePwa } from "./pwa";

/**
 * The shell's notices, one at a time, floating at the foot of the page
 * (ShellNotice): a new version is ready (Reload), or the one-time offer to
 * install the app (PR 2 question 4: from the second visit, phone and desktop,
 * Not Now holds 30 days, never once installed).
 */
export function ShellNotices() {
  const { update, banner } = usePwa();
  const installApp = useInstallApp();
  if (update) {
    return (
      <ShellNotice
        icon="refresh"
        actions={
          <Button variant="primary" size="sm" onClick={() => void update()}>
            Reload
          </Button>
        }
      >
        A new version is ready
      </ShellNotice>
    );
  }
  if (banner) {
    return (
      <ShellNotice
        icon="download"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => installLater()}>
              Not Now
            </Button>
            <Button variant="primary" size="sm" onClick={installApp}>
              Install App
            </Button>
          </>
        }
      >
        Install MyCity App on this device
      </ShellNotice>
    );
  }
  return null;
}

/** Install App: the browser's own prompt, or on an iPhone the Add to Home Screen steps. */
export function useInstallApp() {
  const modal = useModal();
  return useCallback(() => {
    void install().then((r) => {
      if (r !== "steps") return;
      modal.open({
        title: "Install MyCity App",
        body: () => (
          <ol className="flex flex-col gap-3 text-base">
            <li className="flex items-center gap-3">
              <span className="flex size-10 flex-none items-center justify-center rounded-box bg-accent text-accent-foreground">
                <Icon name="share" size="m" />
              </span>
              Tap Share in the toolbar
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-10 flex-none items-center justify-center rounded-box bg-accent text-accent-foreground">
                <Icon name="addbox" size="m" />
              </span>
              Choose Add to Home Screen
            </li>
          </ol>
        ),
        footer: (close) => (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ),
      });
    });
  }, [modal]);
}
