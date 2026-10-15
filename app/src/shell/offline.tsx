import { useEffect, useSyncExternalStore } from "react";
import { invalidate } from "@/api/hooks";
import { Button, EmptyState } from "@mycity/ui";

/**
 * The offline page (FRONTEND_GUIDE §9.7). The installed app opens without a
 * connection (the shell is precached), but every number on a screen is live
 * and the API is never cached, so with no connection the page area shows this
 * instead of a screen of errors. The shell stays: the person can still move
 * around. When the connection returns, every mounted read reloads.
 */
const subscribe = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};

/** Is the browser online? */
export function useOnline(): boolean {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  useEffect(() => {
    if (online) invalidate("/api/");
  }, [online]);
  return online;
}

export function OfflinePage() {
  return (
    <EmptyState
      illustration="Offline"
      title="No Connection"
      text="Reconnect to see live data."
      action={
        <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      }
    />
  );
}
