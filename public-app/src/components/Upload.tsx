import { useRef, useState, type DragEvent } from "react";
import type { DocumentRef } from "@/api/types/common";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { Icon } from "./Icon";

/**
 * The upload engine's front end on the public site (gate 18): the ONLY file
 * input here. One file, its name and size the moment the picker closes, a
 * percentage while it travels, then an explicit "Upload complete". A 12 MB
 * phone photograph on a Lagos connection must never look like a frozen screen.
 *
 * Live: multipart POST to `endpoint` (e.g. /api/public/v1/apply/<token>/cv,
 * INTERIM), answered with the vault document. Mock: the same progress, simulated.
 */
type State = { name: string; size: number; pct: number; doc?: DocumentRef; error?: string };

export function Upload({ endpoint, accept, maxBytes, kinds, onUploaded, state: fieldState }: { endpoint: string; accept: string; maxBytes: number; kinds: string; onUploaded: (doc: DocumentRef | null) => void; state?: "bad" }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<State | null>(null);
  const [over, setOver] = useState(false);

  const start = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    onUploaded(null);
    const okType = accept.split(",").some((ext) => f.name.toLowerCase().endsWith(ext.trim()));
    if (!okType) return setFile({ name: f.name, size: f.size, pct: 0, error: `Not a ${kinds} file` });
    if (f.size > maxBytes) return setFile({ name: f.name, size: f.size, pct: 0, error: `Larger than ${formatBytes(maxBytes)}` });
    setFile({ name: f.name, size: f.size, pct: 0 });
    send(f, endpoint, (pct) => setFile((s) => (s ? { ...s, pct } : s)))
      .then((doc) => {
        setFile((s) => (s ? { ...s, pct: 100, doc } : s));
        onUploaded(doc);
      })
      .catch((e: Error) => setFile((s) => (s ? { ...s, error: e.message } : s)));
  };

  const pick = () => input.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    start(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("rounded-[10px] border-[1.5px] border-dashed p-[18px] text-center transition-colors", fieldState === "bad" && !file ? "border-destructive" : "border-input", over && "border-ring bg-accent")}
    >
      <Icon name={file?.error ? "alert" : file?.doc ? "ok" : "doc"} size="m" className={cn("mx-auto", file?.error ? "text-destructive" : file?.doc ? "text-success" : "text-muted-foreground")} />
      {file ? (
        <>
          <div className="mt-1.5 truncate text-[13px]">{file.name}</div>
          <div className={cn("text-[12px]", file.error ? "text-destructive" : "text-subtle-foreground")}>
            {file.error ?? `${formatBytes(file.size)} · ${file.doc ? "Upload complete" : `uploading, ${file.pct}%`}`}
          </div>
          {!file.error && (
            <div className="mx-auto mt-[9px] flex max-w-[220px] items-center gap-2 text-[11px] text-subtle-foreground">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <i className="block h-full rounded-full bg-secondary transition-[width] duration-100" style={{ width: `${file.pct}%` }} />
              </span>
              <span className="w-8 text-right">{file.pct}%</span>
            </div>
          )}
          {(file.doc || file.error) && (
            <button type="button" onClick={pick} className="mt-2.5 text-[12.5px] font-semibold text-accent-foreground underline underline-offset-2">
              Choose a different file
            </button>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={pick} className="mt-1.5 text-[13px] font-semibold text-accent-foreground underline underline-offset-2">
            Choose your CV, or drop it here
          </button>
          <div className="text-[12px] text-subtle-foreground">
            {kinds}, up to {formatBytes(maxBytes)}
          </div>
        </>
      )}
      <input ref={input} type="file" className="hidden" accept={accept} onChange={(e) => (start(e.target.files), (e.target.value = ""))} />
    </div>
  );
}

function send(file: File, endpoint: string, progress: (pct: number) => void): Promise<DocumentRef> {
  if (import.meta.env.VITE_API_MODE === "mock") {
    return new Promise((resolve) => {
      let pct = 0;
      const t = setInterval(() => {
        pct = Math.min(100, pct + 9 + Math.round(Math.random() * 16));
        progress(pct);
        if (pct >= 100) {
          clearInterval(t);
          resolve({ document_id: crypto.randomUUID(), file_name: file.name, size_bytes: file.size, mime_type: file.type || "application/octet-stream" });
        }
      }, 110);
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => e.lengthComputable && progress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(res as DocumentRef);
        else reject(new Error(res?.error?.message ?? "Upload failed. Try again."));
      } catch {
        reject(new Error("Upload failed. Try again."));
      }
    };
    xhr.onerror = () => reject(new Error("You appear to be offline. Try again."));
    xhr.send(body);
  });
}
