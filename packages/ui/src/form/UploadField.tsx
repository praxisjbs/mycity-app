/**
 * @component UploadField
 * @group Forms
 * @summary The upload engine: the only file input in the product, with a percentage per file and the vault's document as its answer.
 * @use Anywhere a person attaches a file: a CV, a receipt, a signed offer, a mail attachment, an import sheet.
 * @avoid A raw `<input type="file">` anywhere else (gate 18); storing a path or a name instead of the `document_id`; a silent wait on a large file.
 * @phone The drop zone is a full-width tap target, since a phone cannot drop; every file shows its own percentage as it travels.
 * @a11y The words in the drop zone are a real button, which opens the picker; the progress is a named meter per file, and each file's state is in words as well as a glyph.
 * @status stable
 * @example <UploadField purpose="receipt" endpoint="/api/v1/documents" upload={api.upload} onUploaded={(docs) => form.set("receipts", docs)} />
 */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatBytes } from "../lib/format";
import { uploadFile, type DocumentRef, type Uploader } from "../lib/upload";
import { IconButton } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { Tooltip } from "../overlay/Tooltip";

/** One file on its way, or arrived, or refused. */
interface Travelling {
  key: string;
  name: string;
  size: number;
  percent: number;
  doc?: DocumentRef;
  error?: string;
}

/** 25 MB: what the vault takes, and what a phone photograph fits inside. */
const MAX_BYTES = 25 * 1024 * 1024;

/** At most ten files at once, so one drop cannot queue a hundred requests. */
const MAX_FILES = 10;

export interface UploadFieldProps {
  /** Where the multipart goes; `/api/v1/documents` unless the route is its own. */
  endpoint?: string;
  /** What the file is for: the server reads it to decide which types it takes. */
  purpose: string;
  /**
   * More text fields to send beside the file, for a route that needs to know
   * what the file is being attached to (the import it starts, the request it
   * answers). The server still decides everything it can decide itself.
   */
  fields?: Record<string, string>;
  /** How the file is sent; the app's own client, which adds its session. The bare engine otherwise. */
  upload?: Uploader;
  /** Several files at once (the default), or exactly one. */
  multiple?: boolean;
  /** What the picker offers, as extensions (".pdf,.jpg"). */
  accept?: string;
  /** The biggest file taken; 25 MB unless set. */
  maxBytes?: number;
  /** Called with the documents once they have all arrived. */
  onUploaded?: (docs: DocumentRef[]) => void;
  /** The words in the drop zone, at most 6 words. */
  label?: string;
  /** What kinds of file are wanted, lower case, for the line under the words ("PDF or Word"). */
  kinds?: string;
  /** A tighter drop zone, inside a sheet or beside a form's footer. */
  compact?: boolean;
  /** A control of the caller's instead of the drop zone (a composer's clip); the tray still shows. */
  trigger?: (open: () => void) => ReactNode;
  /**
   * Open the device's picker as soon as the field shows, where the browser allows it (a sheet
   * opened from a menu, such as Send Files); otherwise the person taps the drop zone.
   */
  autoOpen?: boolean;
  /**
   * The caller lists what arrived itself (a composer's attachment chips), so a
   * finished file leaves the tray once it is handed over and is never shown twice.
   */
  handOff?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function UploadField({
  endpoint = "/api/v1/documents",
  purpose,
  fields,
  upload = uploadFile,
  multiple = true,
  accept,
  maxBytes = MAX_BYTES,
  onUploaded,
  label = "Drop files here, or browse",
  kinds,
  compact,
  trigger,
  autoOpen,
  handOff,
  className,
}: UploadFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    // Once, while the press that opened the sheet still lets a page open the picker.
    if (!autoOpen || opened.current) return;
    opened.current = true;
    input.current?.click();
  }, [autoOpen]);
  const [files, setFiles] = useState<Travelling[]>([]);
  const [over, setOver] = useState(false);

  const patch = (key: string, change: Partial<Travelling>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const start = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const chosen = Array.from(picked).slice(0, multiple ? MAX_FILES : 1);
    const added: Travelling[] = chosen.map((file, i) => ({
      key: `${file.name}-${file.size}-${Date.now()}-${i}`,
      name: file.name,
      size: file.size,
      percent: 0,
      error: file.size > maxBytes ? `Larger than ${formatBytes(maxBytes)}` : undefined,
    }));
    setFiles((list) => (multiple ? [...list, ...added] : added));

    // Kept in the order picked, whichever finishes first, so photos sent together stay in order.
    const done: Array<DocumentRef | undefined> = [];
    let waiting = added.filter((f) => !f.error).length;
    if (waiting === 0) return;

    added.forEach((item, i) => {
      if (item.error) return;
      upload({ endpoint, file: chosen[i]!, fields: { purpose, ...fields }, onProgress: (percent) => patch(item.key, { percent }) })
        .then((doc) => {
          patch(item.key, { percent: 100, doc });
          done[i] = doc;
        })
        .catch((e: Error) => patch(item.key, { error: e.message }))
        .finally(() => {
          waiting -= 1;
          const arrived = done.filter((d): d is DocumentRef => d !== undefined);
          if (waiting > 0 || arrived.length === 0) return;
          onUploaded?.(arrived);
          if (handOff) {
            const handed = new Set(arrived);
            setFiles((list) => list.filter((f) => !f.doc || !handed.has(f.doc)));
          }
        });
    });
  };

  const open = () => input.current?.click();
  /*
   * Out of sight and out of the reading order: the words in the drop zone are
   * the button a person presses, and this input only carries the picker. A
   * display:none input still opens it when the button asks (`open` below).
   */
  const picker = (
    <input
      ref={input}
      type="file"
      className="hidden"
      accept={accept}
      multiple={multiple}
      aria-label={label}
      onChange={(e) => {
        start(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className={className}>
      {trigger ? (
        <>
          {trigger(open)}
          {picker}
        </>
      ) : (
        <div
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setOver(false);
            start(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 rounded-box border border-dashed border-input bg-muted text-center transition-colors",
            compact ? "p-3" : "p-6",
            over && "border-ring bg-accent",
          )}
        >
          <Icon name="clip" size="m" className="text-accent-foreground" />
          <button type="button" onClick={open} className="text-sm font-semibold text-accent-foreground underline underline-offset-2 phone:min-h-tap">
            {label}
          </button>
          <span className="text-2xs text-subtle-foreground">
            {kinds ? `${kinds}, up to ${formatBytes(maxBytes)}` : `Up to ${formatBytes(maxBytes)} each`}
          </span>
          {picker}
        </div>
      )}

      {files.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0 pt-2">
          {files.map((file) => (
            <li key={file.key} className="flex min-w-44 flex-col gap-1 rounded-ctl border border-border bg-muted px-3 py-1.5 text-xs font-semibold">
              <span className="flex items-center gap-2">
                <Icon
                  name={file.error ? "alert" : file.doc ? "ok" : "doc"}
                  size="s"
                  className={cn("flex-none", file.error && "text-destructive", file.doc && "text-success")}
                />
                <Tooltip label={file.name}>
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                </Tooltip>
                {file.error ? (
                  <IconButton
                    icon="x"
                    size="sm"
                    label={`Remove ${file.name}`}
                    className="-my-1 -mr-2"
                    onClick={() => setFiles((list) => list.filter((f) => f.key !== file.key))}
                  />
                ) : (
                  <span className="flex-none text-2xs font-normal text-subtle-foreground tabular-nums">
                    {file.doc ? "Done" : `${file.percent}%`}
                  </span>
                )}
              </span>
              {file.error ? (
                <span className="text-2xs font-normal text-destructive">{file.error}</span>
              ) : (
                <span
                  role="meter"
                  aria-label={`${file.name} upload`}
                  aria-valuenow={file.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 overflow-hidden rounded-full bg-background"
                >
                  <span className="block h-full w-(--upload-fill) rounded-full bg-secondary transition-all" style={{ "--upload-fill": `${file.percent}%` } as CSSProperties} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
