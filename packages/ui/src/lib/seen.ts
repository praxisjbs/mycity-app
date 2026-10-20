import { useCallback, useEffect, useRef } from "react";

/**
 * A ref that calls `onSeen` once, when its element first comes within `margin` of the
 * screen: a chat's pictures are fetched as they scroll near, not all at once. Where the
 * browser has no IntersectionObserver (a test), it calls at once.
 *
 *   const seen = useSeen(() => setWanted(true));
 *   return <div ref={seen}>...</div>;
 */
export function useSeen<T extends Element>(onSeen: (() => void) | undefined, margin = "600px") {
  const latest = useRef(onSeen);
  const fired = useRef(false);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    latest.current = onSeen;
  }, [onSeen]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || fired.current) return;
      const fire = () => {
        if (fired.current || !latest.current) return;
        fired.current = true;
        latest.current();
      };
      if (typeof IntersectionObserver === "undefined") {
        fire();
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          fire();
        },
        { rootMargin: margin },
      );
      io.observe(el);
      observer.current = io;
    },
    [margin],
  );
}
