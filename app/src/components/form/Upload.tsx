import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn, formatBytes, Icon } from "@mycity/ui";
import { session } from "@/api/client";
import type { DocumentRef } from "@/api/types/common";

/**
 * The upload engine's front end (gate 18): the ONLY file input in the app.
 * Every file shows its percentage while it travels; the result is a vault
 * `document_id`, which is what a record stores.
 *
 * Live: POST /api/v1/documents (multipart, `purpose` decides the MIME policy
 * server side). Mock: the same progress, simulated, and a made-up document id.
 */
type Item = {
  key: string;
  name: string;
  size: number;
  pct: number;
  doc?: DocumentRef;
  error?: string;
};

export function UploadField({
  purpose,
  accept,
  multiple = true,
  maxBytes = 25 * 1024 * 1024,
  onUploaded,
  label = "Drop files here, or browse",
  compact,
  endpoint = "/api/v1/documents",
  trigger,
}: {
  purpose: string;
  /** Where the multipart goes. Every route answers with a DocumentRef-shaped body. */
  endpoint?: string;
  /** A button of the caller's instead of the drop zone (a composer's 📎); the progress tray still shows. */
  trigger?: (open: () => void) => ReactNode;
  accept?: string;
  multiple?: boolean;
  maxBytes?: number;
  onUploaded?: (docs: DocumentRef[]) => void;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) =>
      list.map((i) => (i.key === key ? { ...i, ...patch } : i)),
    );

  const start = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).slice(0, multiple ? 10 : 1);
    const added: Item[] = picked.map((f) => ({
      key: `${f.name}-${f.size}-${Math.random()}`,
      name: f.name,
      size: f.size,
      pct: 0,
      error:
        f.size > maxBytes ? `Larger than ${formatBytes(maxBytes)}` : undefined,
    }));
    setItems((list) => (multiple ? [...list, ...added] : added));
    const done: DocumentRef[] = [];
    let left = added.filter((a) => !a.error).length;
    added.forEach((item, i) => {
      if (item.error) return;
      send(picked[i], purpose, endpoint, (pct) => update(item.key, { pct }))
        .then((doc) => {
          update(item.key, { pct: 100, doc });
          done.push(doc);
        })
        .catch((e: Error) => update(item.key, { error: e.message }))
        .finally(() => {
          left -= 1;
          if (left === 0 && done.length) onUploaded?.(done);
        });
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    start(e.dataTransfer.files);
  };

  return (
    <div>
      {trigger ? (
        <>
          {trigger(() => input.current?.click())}
          <input
            ref={input}
            type="file"
            className="hidden"
            accept={accept}
            multiple={multiple}
            onChange={(e) => (start(e.target.files), (e.target.value = ""))}
          />
        </>
      ) : (
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-input bg-muted text-center transition-colors",
            compact ? "px-3 py-3" : "px-4 py-6",
            over && "border-ring bg-accent",
          )}
        >
          <Icon name="clip" size="m" className="text-accent-foreground" />
          <button
            type="button"
            className="text-[13px] font-semibold text-accent-foreground underline underline-offset-2"
            onClick={() => input.current?.click()}
          >
            {label}
          </button>
          <span className="text-[11.5px] text-subtle-foreground">
            Up to {formatBytes(maxBytes)} each
          </span>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept={accept}
            multiple={multiple}
            onChange={(e) => (start(e.target.files), (e.target.value = ""))}
          />
        </div>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {items.map((it) => (
            <span
              key={it.key}
              className="flex min-w-[170px] flex-col gap-1 rounded-ctl border border-border bg-muted px-[11px] py-[7px] text-[12px] font-[550]"
            >
              <span className="flex items-center gap-[7px]">
                <Icon
                  name={it.error ? "alert" : it.pct === 100 ? "ok" : "doc"}
                  className={
                    it.error
                      ? "text-destructive"
                      : it.pct === 100
                        ? "text-success"
                        : ""
                  }
                />
                <span className="max-w-[180px] truncate">{it.name}</span>
                <span className="ml-auto text-[11.5px] text-subtle-foreground">
                  {it.error ? "" : `${it.pct}%`}
                </span>
              </span>
              {it.error ? (
                <span className="text-[11.5px] text-destructive">
                  {it.error}
                </span>
              ) : (
                <span className="h-1.5 overflow-hidden rounded-full bg-background">
                  <i
                    className="block h-full rounded-full bg-secondary transition-[width] duration-100"
                    style={{ width: `${it.pct}%` }}
                  />
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function send(
  file: File,
  purpose: string,
  endpoint: string,
  progress: (pct: number) => void,
): Promise<DocumentRef> {
  if (import.meta.env.VITE_API_MODE === "mock") {
    return new Promise((resolve) => {
      let pct = 0;
      const t = setInterval(() => {
        pct = Math.min(100, pct + 8 + Math.round(Math.random() * 18));
        progress(pct);
        if (pct >= 100) {
          clearInterval(t);
          const id = crypto.randomUUID();
          /* The mail route answers with an attachment id as well as the document. */
          const doc = {
            document_id: id,
            ...(endpoint.includes("/mailbox/") ? { attachment_id: id } : {}),
            file_name: file.name,
            size_bytes: file.size,
            mime_type: file.type || "application/octet-stream",
          };
          void import("@/api/mock/uploads").then((m) => (m.UPLOADS.set(id, doc), resolve(doc)));
        }
      }, 110);
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("purpose", purpose);
    body.append("file", file);
    xhr.open("POST", endpoint);
    xhr.withCredentials = true;
    if (session.token)
      xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && progress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(res as DocumentRef);
        else reject(new Error(res?.error?.message ?? "Upload failed"));
      } catch {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("You appear to be offline"));
    xhr.send(body);
  });
}
