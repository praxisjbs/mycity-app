/**
 * @component FileCard
 * @group Documents
 * @summary A file in a chat bubble or a list, as on WhatsApp: a PDF's first page over its name, then its pages, type and size, with Download.
 * @use A PDF, a Word, Excel or PowerPoint file, a CSV or a text file posted in a conversation; a file in a list someone opens or saves.
 * @avoid A photo or a video (MediaTile shows the picture itself); a document the product generated (Paper); reading the file in place (PdfViewer, DocumentPreview).
 * @phone The bubble's width (256 px); the card opens the file and Download saves it, each a 44 px target.
 * @a11y The card's main button is named Open with the file's name and says its type; Download is a separate named button; the first page is decorative beside that name.
 * @status beta
 * @example <FileCard name="Call sheet.pdf" mime="application/pdf" sizeBytes={245000} pages={3} preview={src} hasPreview onOpen={open} onDownload={save} />
 */
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { useSeen } from "../lib/seen";
import { IconButton } from "../actions/Button";
import { Icon, type IconName } from "../icons/Icon";

/** What a file is, in words, with its glyph and the tone its glyph sits on. */
export interface FileType {
  label: string;
  glyph: IconName;
  tone: string;
}

const BY_MIME: Record<string, FileType> = {
  "application/pdf": { label: "PDF", glyph: "doc", tone: "bg-destructive-soft text-destructive" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word", glyph: "doc", tone: "bg-info-soft text-info" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel", glyph: "sheet", tone: "bg-success-soft text-success" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { label: "PowerPoint", glyph: "slides", tone: "bg-warning-soft text-warning" },
  "text/csv": { label: "CSV", glyph: "sheet", tone: "bg-success-soft text-success" },
  "text/plain": { label: "Text", glyph: "doc", tone: "bg-muted text-muted-foreground" },
};

/** A file's type in words and its glyph, from the type the server decided (or its name's ending). */
export function fileTypeOf(mime: string, name = ""): FileType {
  const known = BY_MIME[mime];
  if (known) return known;
  if (mime.startsWith("image/")) return { label: "Photo", glyph: "image", tone: "bg-muted text-muted-foreground" };
  if (mime.startsWith("video/")) return { label: "Video", glyph: "video", tone: "bg-muted text-muted-foreground" };
  if (mime.startsWith("audio/")) return { label: "Audio", glyph: "mic", tone: "bg-muted text-muted-foreground" };
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return { label: ext ? ext.toUpperCase() : "File", glyph: "doc", tone: "bg-muted text-muted-foreground" };
}

export interface FileCardProps {
  /** The file's name, as it was sent. */
  name: string;
  /** Its type, as the server decided. */
  mime: string;
  /** Its size. */
  sizeBytes?: number | null;
  /** A PDF's pages, once the worker has counted them. */
  pages?: number | null;
  /** A PDF's first page, ready to draw (fetched with the session); null while it loads or when there is none. */
  preview?: string | null;
  /** Whether the first page exists, so its place is kept while it loads. */
  hasPreview?: boolean;
  /** Opens the file: the viewer for a PDF, a download for a file the app does not show. */
  onOpen?: () => void | Promise<void>;
  /** Saves the file to the device. */
  onDownload?: () => void | Promise<void>;
  /** Called once when the card first comes near the screen, so its first page is fetched only then. */
  onSeen?: () => void;
  /** Where it sits: in the sender's own bubble, in another's, or on the page. */
  tone?: "mine" | "theirs" | "plain";
  /** Layout classes only (spacing). */
  className?: string;
}

const TONE = {
  mine: "bg-white/10",
  theirs: "bg-black/5",
  plain: "border border-border bg-card",
} as const;

export function FileCard({ name, mime, sizeBytes, pages, preview, hasPreview, onOpen, onDownload, onSeen, tone = "theirs", className }: FileCardProps) {
  const seen = useSeen<HTMLDivElement>(onSeen);
  const type = fileTypeOf(mime, name);
  const meta = [pages ? `${pages} ${pages === 1 ? "page" : "pages"}` : null, type.label, sizeBytes != null ? formatBytes(sizeBytes) : null]
    .filter(Boolean)
    .join(" · ");
  const open = onOpen ? () => onOpen() : undefined;

  return (
    <div ref={seen} className={cn("w-72 max-w-full overflow-hidden rounded-box phone:w-64", TONE[tone], className)}>
      {(hasPreview || preview) && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={open}
          className="block h-32 w-full overflow-hidden border-b border-black/5 bg-paper"
        >
          {preview ? <img src={preview} alt="" className="size-full object-cover object-top" /> : <span className="block size-full animate-pulse bg-black/10" />}
        </button>
      )}
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={open}
          aria-label={`Open ${name}, ${type.label}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ctl text-left phone:min-h-tap focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className={cn("flex size-9 flex-none items-center justify-center rounded-ctl", type.tone)}>
            <Icon name={type.glyph} size="m" />
          </span>
          <span className="min-w-0">
            <b data-copy="content" className="line-clamp-2 text-xs font-strong break-all">
              {name}
            </b>
            <span className="block text-2xs opacity-75">{meta}</span>
          </span>
        </button>
        {onDownload && <IconButton icon="download" label={`Download ${name}`} size="sm" className="flex-none text-current" onClick={onDownload} />}
      </div>
    </div>
  );
}
