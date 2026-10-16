/**
 * @component DocumentPreview
 * @group Documents
 * @summary A file from the vault as the browser draws it: a PDF inline, a picture in the image viewer, and Open in New Tab on both.
 * @use Looking at what someone attached: a receipt, a CV, a signed offer, a mail attachment, an imported sheet.
 * @avoid A document the product generated itself (use Paper, which prints right); shipping a PDF renderer of our own; a preview with no way out to the file.
 * @phone Shorter, and anything the browser will not draw inline becomes a Download card instead of an empty frame.
 * @a11y The frame is named by the file, Open in New Tab and Download are real links, and a file that cannot be shown says so in words.
 * @status stable
 * @example <DocumentPreview name="Receipt.pdf" mime="application/pdf" href={`/api/v1/documents/${id}/file`} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { Button } from "../actions/Button";
import { Icon, type IconName } from "../icons/Icon";
import { EmptyState } from "../display/EmptyState";
import { ImageViewer } from "./ImageViewer";

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
  /** Where the vault streams it (`/api/v1/documents/:id/file`). */
  href: string;
  /** Its size, for the line under the name. */
  sizeBytes?: number;
  /** How tall the frame is; `md` unless a sheet wants it shorter or a page taller. */
  height?: "sm" | "md" | "lg";
  /** What sits beside Open in New Tab (Replace, Remove). */
  actions?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

const HEIGHT = { sm: "h-64", md: "h-96", lg: "h-168" } as const;

export function DocumentPreview({ name, mime, href, sizeBytes, height = "md", actions, className }: DocumentPreviewProps) {
  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");

  const bar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2">
      <Icon name={glyphFor(mime)} size="s" className="flex-none text-subtle-foreground" />
      <span className="min-w-0 flex-1">
        <b data-copy="content" className="block truncate text-xs font-semibold" title={name}>
          {name}
        </b>
        {sizeBytes != null && <span className="text-2xs text-subtle-foreground">{formatBytes(sizeBytes)}</span>}
      </span>
      {actions}
      <Button asChild size="sm" iconRight="external">
        <a href={href} target="_blank" rel="noreferrer">
          Open in New Tab
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
    body = (
      <object data={href} type="application/pdf" aria-label={name} className={cn("block w-full", HEIGHT[height])}>
        {/*
         * An <object>'s own children are what the browser shows when it will
         * not draw the PDF here, iOS Safari included, and when the file itself
         * does not arrive. That is the standard fallback and needs no script,
         * so there is no error handler to go wrong. It offers the download
         * rather than a second Open in New Tab, which the bar already carries.
         */}
        {download("Cannot Show Here", "Download it, or open it in a new tab.")}
      </object>
    );
  } else {
    body = download("Download To Read", "This kind of file opens in its own app.");
  }

  return (
    <div className={cn("max-w-full min-w-0 overflow-hidden rounded-card border border-border bg-card", className)}>
      {bar}
      {body}
    </div>
  );
}
