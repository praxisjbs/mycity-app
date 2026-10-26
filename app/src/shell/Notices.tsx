import { useCallback, useState } from "react";
import { Button, Icon, ShellNotice, useModal } from "@mycity/ui";
import { turnOnPush, usePushState } from "@/features/notifications/push";
import { clearGuideReturn, guideHref, useGuideReturn } from "@/features/knowledge/guide/return";
import { moduleKeyOf, useRouter } from "@/lib/router";
import { install, installLater, usePwa } from "./pwa";

/**
 * The shell's notices, one at a time, floating at the foot of the page
 * (ShellNotice): a new version is ready (Reload); the way back to the User Guide
 * after a step opened a screen (Back to Guide, docs/guides/user-guide.md §3),
 * on every screen but the guide itself; turning notifications on for
 * this device, never asked yet (docs/guides/notifications.md §2: never the
 * browser's prompt unasked; Not Now holds 14 days on this device); or the
 * one-time offer to install the app (PR 2 question 4: from the second visit,
 * phone and desktop, Not Now holds 30 days, never once installed). None of the
 * offers floats over a message box (writingScreen).
 */
const PUSH_LATER = "mc-push-later";
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
const pushLaterUntil = () => {
  try {
    return Number(localStorage.getItem(PUSH_LATER)) || 0;
  } catch {
    return 0;
  }
};

/**
 * A screen whose message box sits at the foot of the page, where a floating offer would cover
 * it: every Staff Community tab, and Praxis AI's Ask (its first tab, so also with no tab). The
 * update, notifications and install offers wait for the next other screen; Back to Guide still
 * shows there, as the reader asked for it and it closes.
 */
export function writingScreen(module: string | null, tab: string | null): boolean {
  const key = module ? moduleKeyOf(module) : null;
  return key === "community" || (key === "praxis_ai" && (tab ?? "ask") === "ask");
}

export function ShellNotices() {
  const { update, banner } = usePwa();
  const back = useGuideReturn();
  const { location, navigate } = useRouter();
  const onGuide = location.module === "knowledge" && location.tab === "user-guide";
  const writing = writingScreen(location.module, location.tab);
  const installApp = useInstallApp();
  const push = usePushState();
  const [laterUntil, setLaterUntil] = useState(pushLaterUntil);
  const pushLater = () => {
    const until = Date.now() + FOURTEEN_DAYS;
    try {
      localStorage.setItem(PUSH_LATER, String(until));
    } catch {
      /* the offer then shows again next time */
    }
    setLaterUntil(until);
  };
  if (update && !writing) {
    return (
      <ShellNotice
        icon="refresh"
        actions={
          <Button variant="primary" size="sm" onClick={update}>
            Reload
          </Button>
        }
      >
        A new version is ready
      </ShellNotice>
    );
  }
  if (back && !onGuide) {
    return (
      <ShellNotice
        icon="book"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={clearGuideReturn}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="left"
              onClick={() => {
                navigate(guideHref(back));
                clearGuideReturn();
              }}
            >
              Back to Guide
            </Button>
          </>
        }
      >
        <span data-copy="content">{back.step ? `${back.title} · Step ${back.step}` : back.title}</span>
      </ShellNotice>
    );
  }
  if (writing) return null;
  if (push === "ask" && laterUntil < Date.now()) {
    return (
      <ShellNotice
        icon="bell"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={pushLater}>
              Not Now
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => turnOnPush()}
            >
              Turn On
            </Button>
          </>
        }
      >
        Get notified of new mail and approvals
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

/** Install App: the browser's own prompt, or on an iPhone the Add to Home Screen steps. Its button spins while the prompt is open. */
export function useInstallApp() {
  const modal = useModal();
  return useCallback(() => {
    return install().then((r) => {
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
