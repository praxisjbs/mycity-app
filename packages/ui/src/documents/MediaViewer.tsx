/**
 * @component MediaViewer
 * @group Documents
 * @summary A photo, a video or a PDF full screen, as on WhatsApp: zoom, step to the next, Download, Share on a phone, and Forward where the screen offers it.
 * @use Opening a file someone sent or attached: a chat's photos, videos and PDFs, a conversation's shared files, a mail attachment, a document on My Documents.
 * @avoid A file the app cannot show (Word, Excel, PowerPoint: download it instead); a preview beside a list on desktop (DocumentPreview); a document the product generated (Paper).
 * @phone The whole screen on deep green: Close, who sent it and when, Forward, Share and Download along the top; swipe left or right to step, down to close; pinch or double tap a photo to zoom; the phone's Back closes it.
 * @a11y A modal dialog named by the file: focus moves in and is trapped, Esc closes it and focus returns to what opened it; the arrow keys step on desktop; every control is a named button; a file that cannot be shown says so, with Download beside it.
 * @status beta
 * @example <MediaViewer open={open} items={items} index={at} onIndex={setAt} onClose={close} load={(item) => fetchFile(item)} />
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Button, IconButton } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import { LinkText } from "../display/LinkText";
import { PdfViewer } from "./PdfViewer";
import { fileTypeOf } from "./FileCard";

/** One file the viewer can show. */
export interface ViewerItem {
  /** A key that stays the same for this file. */
  key: string;
  /** The file's name, as it was sent. */
  name: string;
  /** Its type, as the server decided: a photo, a video or a PDF is shown, anything else offered as a download. */
  mime: string;
  /** Who sent it. */
  by?: string | null;
  /** When, as a person reads it ("Today, 14:02"). */
  at?: string | null;
  /** Its caption; its links open. */
  caption?: string | null;
  /** A picture to show at once while the file itself arrives: the bubble's photo, a video's poster. */
  poster?: string | null;
}

export interface MediaViewerProps {
  /** Whether it is showing. */
  open: boolean;
  /** The files it steps through, in order. */
  items: ViewerItem[];
  /** Which one is showing. */
  index: number;
  /** Called to show another: the arrows, the keyboard, a swipe. */
  onIndex: (index: number) => void;
  /** Called to close it: Close, Esc, a swipe down, the phone's Back. */
  onClose: () => void;
  /** The file itself, fetched with the session: drawn here, and what Download and Share save. */
  load: (item: ViewerItem) => Promise<Blob>;
  /** How Download hands the file to this device (the app's own, which uses the share sheet where a download cannot land); the browser's download otherwise. */
  save?: (blob: Blob, name: string) => unknown;
  /** Forward the file on view to a chat; no Forward unless set. */
  onForward?: (item: ViewerItem) => void;
  /** Where it mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

type Kind = "photo" | "video" | "pdf" | "other";
const kindOf = (mime: string): Kind =>
  mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : mime === "application/pdf" ? "pdf" : "other";

/** Save a file the browser already holds. */
function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Whether this device's share sheet takes a file of this type (phones; never a desktop browser here). */
function canShareFile(item: ViewerItem): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") return false;
  try {
    return navigator.canShare({ files: [new File([], item.name, { type: item.mime })] });
  } catch {
    return false;
  }
}

const ZOOMS = [1, 1.5, 2.5, 4] as const;
const SWIPE_PX = 60;
const CLOSE_PX = 110;

interface View {
  s: number;
  x: number;
  y: number;
}

/** A photo that zooms: pinch, double tap or the buttons; dragged when zoomed, swiped when not. */
function PhotoStage({ src, alt, onStep, onClose, phone }: { src: string | null; alt: string; onStep: (by: 1 | -1) => void; onClose: () => void; phone: boolean }) {
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pinch" | "pan" | "swipe"; d0: number; s0: number; x0: number; y0: number; px: number; py: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    setView({ s: 1, x: 0, y: 0 });
    setDrag({ x: 0, y: 0 });
  }, [src]);

  const distance = () => {
    const [a, b] = [...points.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const zoomTo = (s: number) => setView((v) => (s <= 1 ? { s: 1, x: 0, y: 0 } : { ...v, s }));

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setActive(true);
    if (points.current.size === 2) gesture.current = { kind: "pinch", d0: distance(), s0: view.s, x0: view.x, y0: view.y, px: 0, py: 0 };
    else if (points.current.size === 1)
      gesture.current = { kind: view.s > 1 ? "pan" : "swipe", d0: 0, s0: view.s, x0: view.x, y0: view.y, px: e.clientX, py: e.clientY };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.current.has(e.pointerId)) return;
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && g.d0 > 0) {
      const s = Math.min(4, Math.max(1, (g.s0 * distance()) / g.d0));
      setView((v) => (s === 1 ? { s: 1, x: 0, y: 0 } : { ...v, s }));
    } else if (g.kind === "pan") {
      setView((v) => ({ ...v, x: g.x0 + e.clientX - g.px, y: g.y0 + e.clientY - g.py }));
    } else if (g.kind === "swipe") {
      setDrag({ x: e.clientX - g.px, y: e.clientY - g.py });
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    points.current.delete(e.pointerId);
    const g = gesture.current;
    if (points.current.size > 0) return;
    gesture.current = null;
    setActive(false);
    if (g?.kind === "swipe") {
      const dx = e.clientX - g.px;
      const dy = e.clientY - g.py;
      setDrag({ x: 0, y: 0 });
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return onStep(dx < 0 ? 1 : -1);
      if (dy > CLOSE_PX && dy > Math.abs(dx)) return onClose();
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && phone) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          lastTap.current = 0;
          zoomTo(view.s > 1 ? 1 : 2.5);
        } else lastTap.current = now;
      }
    }
  };

  const step = ZOOMS.findIndex((z) => z >= view.s - 0.01);
  const at = step < 0 ? ZOOMS.length - 1 : step;
  const style = { "--zoom": String(view.s), "--x": `${view.x + drag.x}px`, "--y": `${view.y + drag.y}px` } as CSSProperties;

  return (
    <div
      className="relative size-full touch-none overflow-hidden select-none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => !phone && zoomTo(view.s > 1 ? 1 : 2.5)}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          data-copy="content"
          draggable={false}
          style={style}
          className={cn(
            "absolute m-auto max-h-full max-w-full translate-x-(--x) translate-y-(--y) scale-(--zoom) object-contain",
            // A phone shows the photo edge to edge; desktop keeps it clear of the arrows and the zoom bar.
            phone ? "inset-0" : "inset-x-16 top-2 bottom-16",
            !active && "transition-transform duration-(--dur-fast)",
          )}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-on-deep">
          <Spinner size="l" label={`Opening ${alt}`} />
        </span>
      )}
      {!phone && src && (
        <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-glass-border bg-glass px-1.5 py-1 text-foreground shadow-2">
          <IconButton label="Zoom Out" icon="zoomout" size="sm" disabled={at === 0} onClick={() => zoomTo(ZOOMS[Math.max(0, at - 1)] ?? 1)} />
          <span aria-live="polite" className="min-w-10 text-center text-2xs font-semibold tabular-nums">
            {Math.round(view.s * 100)}%
          </span>
          <IconButton label="Zoom In" icon="zoomin" size="sm" disabled={at === ZOOMS.length - 1} onClick={() => zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, at + 1)] ?? 4)} />
        </div>
      )}
    </div>
  );
}

interface Loaded {
  blob: Blob;
  url: string;
}

export function MediaViewer({ open, items, index, onIndex, onClose, load, save, onForward, container }: MediaViewerProps) {
  const phone = useIsPhone();
  const item = open ? items[index] : undefined;
  const cache = useRef(new Map<string, Loaded>());
  const content = useRef<HTMLDivElement>(null);
  const [, setVersion] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const loadRef = useRef(load);
  const closeRef = useRef(onClose);
  useEffect(() => {
    loadRef.current = load;
    closeRef.current = onClose;
  }, [load, onClose]);

  /** The file, from this session's cache, the fetch already under way, or fetched now. */
  const pending = useRef(new Map<string, Promise<Loaded>>());
  const fetchItem = useCallback((it: ViewerItem): Promise<Loaded> => {
    const kept = cache.current.get(it.key);
    if (kept) return Promise.resolve(kept);
    const going = pending.current.get(it.key);
    if (going) return going;
    const made = loadRef.current(it)
      .then((blob) => {
        const got = { blob, url: URL.createObjectURL(blob) };
        cache.current.set(it.key, got);
        setVersion((v) => v + 1);
        return got;
      })
      .finally(() => pending.current.delete(it.key));
    pending.current.set(it.key, made);
    return made;
  }, []);

  /* Fetch the file on show; get the next photo ready while this one is looked at. */
  useEffect(() => {
    if (!item) return;
    let live = true;
    setFailed(null);
    fetchItem(item).catch(() => live && setFailed(item.key));
    const next = items[index + 1];
    if (next && kindOf(next.mime) === "photo") fetchItem(next).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [item, items, index, fetchItem]);

  /* Closed: every file it fetched is let go. */
  useEffect(() => {
    if (open) return;
    const kept = cache.current;
    kept.forEach((l) => URL.revokeObjectURL(l.url));
    kept.clear();
  }, [open]);
  useEffect(() => {
    const kept = cache.current;
    return () => kept.forEach((l) => URL.revokeObjectURL(l.url));
  }, []);

  /* On a phone the system's Back closes the viewer, not the screen behind it. */
  useEffect(() => {
    if (!open || !phone) return;
    const mark = `mc-viewer-${Date.now()}`;
    let byBack = false;
    window.history.pushState({ ...(window.history.state ?? {}), mcViewer: mark }, "");
    const onPop = () => {
      byBack = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!byBack && window.history.state?.mcViewer === mark) window.history.back();
    };
  }, [open, phone]);

  const step = useCallback(
    (by: 1 | -1) => {
      const next = index + by;
      if (next >= 0 && next < items.length) onIndex(next);
    },
    [index, items.length, onIndex],
  );

  /* The arrow keys step on desktop. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A PDF scrolled sideways, a video sought or a caption's text keep their own arrows.
      if (e.target instanceof Element && e.target.closest("[role=document], video, input, textarea")) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  if (!item) return null;
  const kind = kindOf(item.mime);
  const loaded = cache.current.get(item.key) ?? null;
  const broken = failed === item.key;
  const share = phone && canShareFile(item);

  const download = async () => {
    const got = loaded ?? (await fetchItem(item));
    await (save ? save(got.blob, item.name) : saveBlob(got.blob, item.name));
  };
  const shareIt = async () => {
    const got = loaded ?? (await fetchItem(item));
    try {
      await navigator.share({ files: [new File([got.blob], item.name, { type: item.mime })], title: item.name });
    } catch {
      /* the person closed the share sheet */
    }
  };

  let stage;
  if (broken) {
    stage = (
      <div role="status" className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-on-deep">
        <Icon name="alert" size="l" />
        <b className="text-sm font-strong">Cannot Open File</b>
        <Button variant="primary" icon="download" onClick={download}>
          Download File
        </Button>
      </div>
    );
  } else if (kind === "photo") {
    stage = <PhotoStage key={item.key} src={loaded?.url ?? item.poster ?? null} alt={item.name} onStep={step} onClose={onClose} phone={phone} />;
  } else if (kind === "video") {
    stage = loaded ? (
      <video key={item.key} src={loaded.url} poster={item.poster ?? undefined} controls playsInline autoPlay className="max-h-full max-w-full" />
    ) : (
      <span className="flex size-full items-center justify-center text-on-deep">
        <Spinner size="l" label={`Opening ${item.name}`} />
      </span>
    );
  } else if (kind === "pdf") {
    stage = <PdfViewer key={item.key} data={loaded?.blob ?? null} name={item.name} height="fill" tone="deep" />;
  } else {
    const type = fileTypeOf(item.mime, item.name);
    stage = (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-on-deep">
        <Icon name={type.glyph} size="l" />
        <b data-copy="content" className="text-sm font-strong break-all">{item.name}</b>
        <Button variant="primary" icon="download" onClick={download}>
          Download File
        </Button>
      </div>
    );
  }

  const glassy = "text-on-deep hover:bg-white/10 hover:text-on-deep";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-deep" />
        <Dialog.Content
          ref={content}
          data-ui="modal"
          aria-modal="true"
          aria-describedby={undefined}
          // Focus goes to the viewer itself, not its first button: Close's label stays hidden and Esc closes at once.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus();
          }}
          className="fixed inset-0 z-50 flex flex-col pt-safe pb-safe text-on-deep outline-none"
        >
          <div className="flex flex-none items-center gap-1 px-1.5 py-1.5">
            <IconButton icon={phone ? "left" : "x"} label="Close" className={glassy} onClick={onClose} />
            <div className="min-w-0 flex-1 px-1">
              <Dialog.Title data-copy="content" className="truncate text-sm font-strong">
                {item.by || item.name}
              </Dialog.Title>
              {(item.at || item.by) && (
                <span data-copy="content" className="block truncate text-2xs text-on-deep-dim">
                  {[item.by ? item.name : null, item.at].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            {onForward && (
              <IconButton
                icon="forward"
                label="Forward"
                className={glassy}
                onClick={() => {
                  // The screen's sheet hands focus back to the viewer itself, not to this button, whose tooltip would take the first Esc.
                  content.current?.focus();
                  onForward(item);
                }}
              />
            )}
            {share && <IconButton icon="share" label="Share" className={glassy} onClick={shareIt} />}
            <IconButton icon="download" label="Download" className={glassy} onClick={download} />
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {stage}
            {!phone && index > 0 && (
              <IconButton icon="left" label="Previous" className={cn("absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/10", glassy)} onClick={() => step(-1)} />
            )}
            {!phone && index < items.length - 1 && (
              <IconButton icon="right" label="Next" className={cn("absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/10", glassy)} onClick={() => step(1)} />
            )}
          </div>
          {item.caption && (
            <div className="max-h-1/4 flex-none overflow-y-auto px-4 py-3 text-sm leading-normal">
              <LinkText text={item.caption} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
