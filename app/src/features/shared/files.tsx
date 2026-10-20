import { useMemo, useState } from "react";
import { fetchFile, saveBlob } from "@/api/download";
import { MediaViewer, type ViewerItem } from "@mycity/ui";

/** The files the viewer shows in the app: photos, videos and PDFs. Anything else is downloaded. */
export const viewableFile = (mime: string | null | undefined): boolean =>
  !!mime && (mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("video/"));

/**
 * The file viewer (MediaViewer) bound to this app's session, for a screen that opens one gated
 * file at a time (My Documents, a mail's attachment): `view(url, item)` shows the file full
 * screen, fetched with the session, and Download and Share save that same copy. Render `viewer`
 * once on the screen. Staff Community steps through a conversation's files instead
 * (features/community/Media.tsx).
 */
export function useFileViewer() {
  const [file, setFile] = useState<{ url: string; item: ViewerItem } | null>(null);
  const [open, setOpen] = useState(false);
  const items = useMemo(() => (file ? [file.item] : []), [file]);
  const view = (url: string, item: Omit<ViewerItem, "key">) => {
    setFile({ url, item: { key: url, ...item } });
    setOpen(true);
  };
  const viewer = (
    <MediaViewer
      open={open && file !== null}
      items={items}
      index={0}
      onIndex={() => undefined}
      onClose={() => setOpen(false)}
      load={() => (file ? fetchFile(file.url) : Promise.reject(new Error("Nothing to open")))}
      save={saveBlob}
    />
  );
  return { view, viewer };
}
