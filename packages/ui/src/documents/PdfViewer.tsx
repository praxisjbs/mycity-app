/**
 * @component PdfViewer
 * @group Documents
 * @summary A PDF's pages drawn in the app by PDF.js, the same on Android, an iPhone and desktop, with the page number and zoom.
 * @use Reading a PDF someone uploaded or sent: a chat file in the file viewer, a document's preview on My Documents, a mail attachment.
 * @avoid A document the product generated and prints (Paper); a photo (ImageViewer); editing or signing a PDF (it only shows one).
 * @phone Fills its frame (or, as `page`, grows to its pages so only the screen scrolls); pages fit the width and scroll, Zoom In and Zoom Out sit at the foot with the page number, each a 44 px target.
 * @a11y The pages are one focusable document named by the file and the page in view, scrolled by the keyboard; zoom buttons are named and the page number is announced; a PDF that cannot be opened says so in words.
 * @status beta
 * @example <PdfViewer data={blob} name="Call sheet.pdf" height="md" />
 */
import { lazy, Suspense } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../display/Skeleton";

/* F22: PDF.js and the drawing load as their own chunk, the first time a PDF is shown. */
const Draw = lazy(() => import("./PdfViewer.draw"));

export interface PdfViewerProps {
  /** The PDF's bytes, fetched with the session; null while they arrive. */
  data: Blob | ArrayBuffer | Uint8Array | null;
  /** The file's name: the document's accessible name. */
  name: string;
  /**
   * A frame of fixed height (`sm`, `md`, `lg`, as DocumentPreview's), `fill` its parent (the
   * full-screen viewer), or `page`: as tall as its pages, for a letter beside a list or in a sheet,
   * so the screen scrolls once rather than a frame scrolling inside it.
   */
  height?: "sm" | "md" | "lg" | "fill" | "page";
  /** The page area's backdrop: the muted card (`card`), or the viewer's deep green (`deep`). */
  tone?: "card" | "deep";
  /** Called when the file cannot be drawn: locked with a password, or damaged. */
  onError?: (reason: "password" | "invalid") => void;
  /** Layout classes only (spacing). */
  className?: string;
}

/** What the drawing chunk receives. */
export type PdfDrawProps = Required<Pick<PdfViewerProps, "data" | "name" | "tone">> & Pick<PdfViewerProps, "onError"> & {
  /** Grow to the pages rather than scroll inside a frame (`height="page"`). */
  flow?: boolean;
};

const HEIGHT = { sm: "h-64", md: "h-96", lg: "h-168", fill: "h-full", page: "" } as const;

export function PdfViewer({ data, name, height = "md", tone = "card", onError, className }: PdfViewerProps) {
  const flow = height === "page";
  // Grown to its pages, the frame has no height of its own while it opens: a page's shape holds it.
  const wait = flow ? "aspect-3/4 w-full rounded-none" : "size-full rounded-none";
  return (
    <div className={cn("relative min-h-0 w-full overflow-hidden", HEIGHT[height], className)}>
      {data ? (
        <Suspense fallback={<Skeleton shape="block" className={wait} />}>
          <Draw data={data} name={name} tone={tone} onError={onError} flow={flow} />
        </Suspense>
      ) : (
        <div role="status" aria-label={`Opening ${name}`} className={flow ? "w-full" : "size-full"}>
          <Skeleton shape="block" className={wait} />
        </div>
      )}
    </div>
  );
}
