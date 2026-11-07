/**
 * @component DocumentFrame
 * @group Documents
 * @summary A document the server drew, a proposal's pages, in a sealed frame exactly as it prints, scaled to its column, its sections pressable for the editor beside it.
 * @use The Proposal Studio's preview and the public Proposal page: complete HTML from the server's document engine, with its own stylesheet and pages (docs/guides/partnerships.md §6.11).
 * @avoid A received email (use EmailFrame); our own long text (use Reader); a stored PDF file (use PdfViewer).
 * @phone The frame takes the screen's width and the document lays itself out in one column by its own rules; on desktop its pages keep their designed width and are scaled down to fit, never scrolled sideways. Pull to refresh never starts on it.
 * @a11y An iframe named by `title`, as its aria-label so no browser tooltip appears. Nothing in the document runs. With `onSelect`, each section is a focusable button inside the frame: Enter or Space selects it, as a press does.
 * @status beta
 * @example <DocumentFrame title="Proposal PRO-0012" html={preview.html} selected={key} onSelect={setKey} />
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "../lib/cn";

/** The kit's pages are 1280 wide with 24 of margin either side. */
const DESIGN_WIDTH = 1328;
/** At or below this width the document reflows to one column instead of being scaled. */
const PHONE = 760;

export interface DocumentFrameProps {
  /** The document's complete HTML, as the server drew it (its pictures and fonts embedded). */
  html: string;
  /** What a screen reader announces for the frame: the document's name. */
  title: string;
  /** The width the document is laid out at on desktop, in CSS pixels. Default 1328, the proposal kit's pages and their margin. */
  designWidth?: number;
  /** The section shown as selected (its `data-section`), or none. */
  selected?: string | null;
  /** A section was pressed or chosen from the keyboard; without it the document is only read. */
  onSelect?: (key: string) => void;
  /** Layout classes only (spacing, width); the look is the document's own. */
  className?: string;
}

/** The HTML with a policy that lets nothing in it run or reach out, and links that open beside the app. */
export function sealDocument(html: string): string {
  const head =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:; media-src \'none\'; frame-src \'none\'; form-action \'none\'">' +
    '<base target="_blank">';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${head}`) : `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export function DocumentFrame({ html, title, designWidth = DESIGN_WIDTH, selected = null, onSelect, className }: DocumentFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const select = useRef(onSelect);
  select.current = onSelect;
  const doc = useMemo(() => sealDocument(html), [html]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const phone = width > 0 && width <= PHONE;
  const frameWidth = phone ? width : designWidth;
  const scale = phone || width === 0 ? 1 : Math.min(1, width / designWidth);

  /** The document's own height, read again whenever it lays itself out anew. */
  const measure = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (d && d.documentElement) setHeight(d.documentElement.scrollHeight);
  }, []);

  /** Each section pressable and reachable from the keyboard, once the document has loaded. */
  const wire = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    measure();
    if (select.current) {
      for (const el of Array.from(d.querySelectorAll<HTMLElement>("[data-section]"))) {
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        const choose = () => select.current?.(el.dataset.section || "");
        el.addEventListener("click", choose);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose();
          }
        });
      }
    }
    if (typeof ResizeObserver !== "undefined" && d.body) new ResizeObserver(measure).observe(d.body);
  }, [measure]);

  useEffect(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    for (const el of Array.from(d.querySelectorAll<HTMLElement>("[data-section]"))) {
      if (selected && el.dataset.section === selected) el.setAttribute("data-selected", "");
      else el.removeAttribute("data-selected");
    }
  }, [selected, height]);

  useEffect(() => {
    measure();
  }, [frameWidth, measure]);

  const vars = {
    "--doc-w": `${frameWidth}px`,
    "--doc-h": `${Math.max(height, 1)}px`,
    "--doc-box-h": `${Math.max(Math.round(height * scale), 1)}px`,
    "--doc-scale": String(scale),
  } as CSSProperties;

  return (
    <div ref={box} className={cn("relative w-full overflow-hidden h-(--doc-box-h)", className)} style={vars} data-pull="off" data-copy="content">
      <iframe
        ref={frame}
        aria-label={title}
        srcDoc={doc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={wire}
        className="block origin-top-left border-0 w-(--doc-w) h-(--doc-h) scale-(--doc-scale)"
      />
    </div>
  );
}
