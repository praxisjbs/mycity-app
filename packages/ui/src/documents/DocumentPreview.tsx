/**
 * @component DocumentPreview
 * @group Documents
 * @summary A file from the vault in a frame: a PDF's pages drawn in the app (PdfViewer), a picture in the image viewer, and Open in Tab on both.
 * @use Looking at what someone attached beside a list: a receipt, a CV, a signed offer, a mail attachment, an imported sheet.
 * @avoid A document the product generated itself (use Paper, which prints right); a file opened full screen (MediaViewer); a preview with no way out to the file.
 * @phone Shorter; a PDF's pages scroll inside the frame, the same as on desktop, and anything else that cannot be drawn becomes a Download card instead of an empty frame.
 * @a11y The frame is named by the file, Open in Tab and Download are real links, and a file that cannot be shown says so in words.
 * @status stable
 * @example <DocumentPreview name="Receipt.pdf" mime="application/pdf" href={href} file={blob} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { Button } from "../actions/Button";
import { Icon, type IconName } from "../icons/Icon";
import { EmptyState } from "../display/EmptyState";
import { ImageViewer } from "./ImageViewer";
import { PdfViewer } from "./PdfViewer";
import { Tooltip } from "../overlay/Tooltip";

/** What a glyph should be for a file we cannot draw. */
function glyphFor(mime: string): IconName {
  if (mime.startsWith("image/")) return "image";
  return "doc";
}

export interface DocumentPreviewProps {
  /** The file's name, as the person uploaded it. */
  name: string;
  /** Its type, as the SERVER decided, not as the browser guessed. */
  mime: string;
  /** The file, ready for the browser (a blob URL the app fetched with the session): what Open in Tab and Download open. */
  href: string;
  /** A PDF's bytes, for PdfViewer to draw; null while they arrive. */
  file?: Blob | null;
  /** Its size, for the line under the name. */
  sizeBytes?: number;
  /** How tall the frame is; `md` unless a sheet wants it shorter or a page taller. */
  height?: "sm" | "md" | "lg";
  /** What sits beside Open in Tab (Replace, Remove). */
  actions?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function DocumentPreview({ name, mime, href, file, sizeBytes, height = "md", actions, className }: DocumentPreviewProps) {
  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");

  const bar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2">
      <Icon name={glyphFor(mime)} size="s" className="flex-none text-subtle-foreground" />
      <span className="min-w-0 flex-1">
        <Tooltip label={name}>
          <b data-copy="content" className="block truncate text-xs font-semibold">
            {name}
          </b>
        </Tooltip>
        {sizeBytes != null && <span className="text-2xs text-subtle-foreground">{formatBytes(sizeBytes)}</span>}
      </span>
      {actions}
      <Button asChild size="sm" iconRight="external">
        <a href={href} target="_blank" rel="noreferrer">
          Open in Tab
        </a>
      </Button>
    </div>
  );

  const download = (title: string, text: string) => (
    <EmptyState
      bare
      icon={glyphFor(mime)}
      title={title}
      text={text}
      action={
        <Button asChild variant="primary" icon="download">
          <a href={href} download={name}>
            Download File
          </a>
        </Button>
      }
    />
  );

  let body: ReactNode;
  if (isImage) {
    body = <ImageViewer src={href} alt={name} height={height} noOpen />;
  } else if (isPdf) {
    // Drawn by PDF.js, not the browser: Android's browser draws no PDF in a page, and the
    // security policy lets no <object> load (FRONTEND_FOUNDATION §5, PR 3 question 4).
    body = <PdfViewer data={file ?? null} name={name} height={height} />;
  } else {
    body = download("Download To Read", "This file opens in its own app.");
  }

  return (
    <div className={cn("max-w-full min-w-0 overflow-hidden rounded-card border border-border bg-card", className)}>
      {bar}
      {body}
    </div>
  );
}
