import { useEffect, useState } from "react";
import { Button, Icon } from "@mycity/ui";

/**
 * PWA (staff app only). The service worker caches the app shell so it opens
 * instantly and installs to a home screen; the API is never cached. When a new
 * version is deployed the person is asked, rather than the page changing under
 * them mid-task.
 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<null | (() => Promise<void>)>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    import("virtual:pwa-register").then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          if (!cancelled) setUpdate(() => () => updateSW(true));
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[85] flex -translate-x-1/2 animate-rise items-center gap-3 rounded-box bg-sidebar px-4 py-3 text-[13px] text-sidebar-foreground shadow-3 max-md:bottom-[78px]">
      <Icon name="spark" className="text-primary" />
      <span>A new version of MyCity App is ready.</span>
      <Button variant="primary" size="sm" onClick={() => void update()}>
        Reload
      </Button>
    </div>
  );
}
