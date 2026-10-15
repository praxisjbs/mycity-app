/**
 * Gallery pages only: overlays portal out of the page, so a state mounts them
 * in its own themed frame (`data-gallery-frame`) to show them in that frame's
 * theme. `const [ref, frame] = useGalleryFrame()`; put `ref` on an element in
 * the state and pass `frame` as the overlay's `container`.
 */
import { useCallback, useState } from "react";

export function useGalleryFrame(): [(node: HTMLElement | null) => void, HTMLElement | null] {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    setFrame(node ? node.closest<HTMLElement>("[data-gallery-frame]") : null);
  }, []);
  return [ref, frame];
}
