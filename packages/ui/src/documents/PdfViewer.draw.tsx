/**
 * PdfViewer's drawing (F22): PDF.js, loaded only when a PDF is first opened. Each page is a
 * canvas drawn when it comes near the screen and emptied again when it is far, so a long PDF
 * never holds every page in memory; a phone's canvas limits are kept by drawing at most
 * eight million pixels a page. PDF.js's own files (standard fonts, character maps, decoders)
 * are served from our origin at /pdfjs/ (vite.shared.js, pdfjsAssets), the only place the
 * security policy lets it fetch from, and nothing in a PDF runs: no scripts, no eval.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { cn } from "../lib/cn";
import { IconButton } from "../actions/Button";
import type { PdfDrawProps } from "./PdfViewer";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;
const ZOOMS = [1, 1.5, 2, 3] as const;
const MAX_PIXELS = 8_000_000;
/** A page opens at the frame's width, up to this many pixels: a wide screen shows a readable page, not half of one. */
const MAX_FIT_PX = 960;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
interface Size {
  w: number;
  h: number;
}

async function bytesOf(data: PdfDrawProps["data"]): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

/** One page: its place kept at its size, its canvas drawn only while it is near the frame's view. */
function Page({ doc, number, size, width, frame }: { doc: Doc; number: number; size: Size; width: number; frame: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const cssW = Math.max(1, Math.round(width));
  const cssH = Math.max(1, Math.round((width * size.h) / size.w));

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // The frame is the root: the pages scroll inside it, so the margin draws the next pages before they show.
    const io = new IntersectionObserver(([entry]) => setNear(Boolean(entry && entry.isIntersecting)), { root: frame, rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [frame]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!near) {
      // Far from the screen: give the memory back.
      el.width = 0;
      el.height = 0;
      return;
    }
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let live = true;
    void doc.getPage(number).then((page) => {
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      let scale = (cssW / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const pixels = base.width * scale * base.height * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      const context = el.getContext("2d");
      if (!context) return;
      task = page.render({ canvasContext: context, viewport, canvas: el });
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, number, near, cssW]);

  return (
    <div
      ref={box}
      data-page={number}
      style={{ "--page-w": `${cssW}px`, "--page-h": `${cssH}px` } as CSSProperties}
      className="relative mx-auto h-(--page-h) w-(--page-w) flex-none bg-paper shadow-2"
    >
      <canvas ref={canvas} aria-hidden="true" className="block size-full" />
      {!near && <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-black/5" />}
    </div>
  );
}

export default function PdfDraw({ data, name, tone, onError, flow }: PdfDrawProps) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  const [fit, setFit] = useState(0);
  const [current, setCurrent] = useState(1);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  /* Open the document, then learn every page's size in the background. */
  useEffect(() => {
    if (!data) return;
    let live = true;
    let opened: Doc | null = null;
    setFailed(false);
    setDoc(null);
    setSizes([]);
    setStep(0);
    setCurrent(1);
    void (async () => {
      try {
        const task = pdfjs.getDocument({
          data: await bytesOf(data),
          isEvalSupported: false,
          enableXfa: false,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
        });
        opened = await task.promise;
        if (!live) {
          void opened.destroy();
          return;
        }
        const first = (await opened.getPage(1)).getViewport({ scale: 1 });
        const guess = { w: first.width, h: first.height };
        setSizes(Array.from({ length: opened.numPages }, () => guess));
        setDoc(opened);
        for (let n = 2; n <= opened.numPages && live; n += 1) {
          const v = (await opened.getPage(n)).getViewport({ scale: 1 });
          if (v.width !== guess.w || v.height !== guess.h) {
            const at = n - 1;
            setSizes((list) => list.map((s, i) => (i === at ? { w: v.width, h: v.height } : s)));
          }
        }
      } catch (err) {
        if (!live) return;
        setFailed(true);
        errorRef.current?.((err as { name?: string })?.name === "PasswordException" ? "password" : "invalid");
      }
    })();
    return () => {
      live = false;
      if (opened) void opened.destroy();
    };
  }, [data]);

  /* Fit the page to the frame's width, and follow it as the frame changes. */
  useEffect(() => {
    const el = frame;
    if (!el) return;
    const measure = () => setFit(Math.max(120, Math.min(MAX_FIT_PX, el.clientWidth - 24)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame, doc]);

  /* The page a person is reading: the one at a third of the frame's height. */
  const onScroll = () => {
    const el = frame;
    if (!el) return;
    const line = el.getBoundingClientRect().top + el.clientHeight / 3;
    let seen = 1;
    for (const page of el.querySelectorAll<HTMLElement>("[data-page]")) {
      if (page.getBoundingClientRect().top <= line) seen = Number(page.dataset.page);
      else break;
    }
    setCurrent(seen);
  };

  const zoom = ZOOMS[step] ?? 1;
  const deep = tone === "deep";

  if (failed) {
    return (
      <div role="status" className={cn("flex size-full flex-col items-center justify-center gap-1 p-6 text-center", deep ? "text-on-deep" : "text-foreground")}>
        <b className="text-sm font-strong">Cannot Open File</b>
        <span className={cn("text-xs", deep ? "text-on-deep-dim" : "text-muted-foreground")}>Download it to open it.</span>
      </div>
    );
  }

  return (
    <div className={flow ? "relative w-full" : "relative size-full"}>
      <div
        ref={setFrame}
        tabIndex={0}
        role="document"
        aria-label={doc ? `${name}, page ${current} of ${doc.numPages}` : name}
        aria-busy={!doc || undefined}
        onScroll={onScroll}
        className={cn(flow ? "w-full overflow-x-auto" : "size-full overflow-auto overscroll-contain", "px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring", deep ? "bg-deep" : "bg-muted")}
      >
        {doc && fit > 0 ? (
          <div className="flex w-max min-w-full flex-col items-center gap-3 pb-14">
            {sizes.map((size, i) => (
              <Page key={i} doc={doc} number={i + 1} size={size} width={fit * zoom} frame={frame} />
            ))}
          </div>
        ) : (
          <div aria-hidden="true" className="mx-auto aspect-3/4 w-full max-w-md animate-pulse bg-paper shadow-2" />
        )}
      </div>
      {doc && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center px-2">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 text-card-foreground shadow-2">
            <span aria-live="polite" className="px-2 text-2xs font-semibold whitespace-nowrap tabular-nums">
              {current} / {doc.numPages}
            </span>
            <IconButton label="Zoom Out" icon="zoomout" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} />
            <span className="min-w-10 text-center text-2xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
            <IconButton label="Zoom In" icon="zoomin" size="sm" disabled={step === ZOOMS.length - 1} onClick={() => setStep((s) => Math.min(ZOOMS.length - 1, s + 1))} />
          </div>
        </div>
      )}
    </div>
  );
}
