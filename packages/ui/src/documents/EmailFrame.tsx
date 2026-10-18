/**
 * @component EmailFrame
 * @group Documents
 * @summary One email body in a sealed frame: the sender's layout kept, scaled down to fit the column, and unable to reach the app.
 * @use The body of a received or drafted email, wherever HTML mail is read (the mailbox reader, a draft preview).
 * @avoid Writing mail HTML into the page with dangerouslySetInnerHTML: its widths overflow a phone and its styles leak; any other HTML (use Reader for our own long text).
 * @phone In the dark theme a message designed for a white page is recoloured (light backgrounds dark, dark text light, brand colours and images kept). A message laid out wider than the screen (the 600 px newsletter, a cPanel notice) is scaled down to the screen's width, as mail apps do, never scrolled sideways.
 * @a11y An iframe named by `title` (the subject), as its aria-label so no browser tooltip appears. Nothing in the message runs: no scripts, forms or frames, whatever the sanitiser missed.
 * @status beta
 * @example <EmailFrame title="Client configuration settings" html={message.body_html} onMailto={(m) => compose(m)} />
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import { recolourHtml, type DarkTheme, type Rgb } from "../lib/email-dark";
import { useTheme } from "../lib/preferences";

/** Below this the text is unreadable; a wider message is shown at this scale and wraps instead. */
const MIN_SCALE = 0.35;

/** The colours and font a message without its own is drawn in, read from the live tokens. */
export interface EmailInk {
  fg: string;
  link: string;
  rule: string;
  font: string;
}

/** The parts of a `mailto:` link, for the composer. */
export interface Mailto {
  to: string[];
  cc: string[];
  subject: string | null;
  body: string | null;
}

export interface EmailFrameProps {
  /** The message body, already sanitised by the server. */
  html: string;
  /** What a screen reader announces for the frame: the subject. */
  title: string;
  /** Lets images load from the web; until then only embedded ones show. */
  remoteImages?: boolean;
  /** A `mailto:` link was pressed; open the composer with it. Without this it opens the device's mail app. */
  onMailto?: (mailto: Mailto) => void;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** `mailto:a@x,b@x?cc=c@x&subject=Hi` as its parts. Anything malformed is read as an address. */
export function parseMailto(href: string): Mailto {
  const raw = href.replace(/^mailto:/i, "");
  const q = raw.indexOf("?");
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
  const decode = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const list = (v: string | null) => (v ? decode(v) : "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return { to: list(q === -1 ? raw : raw.slice(0, q)), cc: list(params.get("cc")), subject: params.get("subject"), body: params.get("body") };
}

/**
 * The document the frame renders. Its own Content-Security-Policy sits on top
 * of the app's: no script, no frames, no forms, inline styles only, and web
 * images only once allowed. The page is transparent, so a message without a
 * background of its own reads on our surface; one that paints its own keeps it.
 */
export function buildEmailDoc(html: string, { remoteImages, ink, scheme }: { remoteImages: boolean; ink: EmailInk; scheme: "light" | "dark" }): string {
  const web = remoteImages ? " https:" : "";
  const csp = ["default-src 'none'", `img-src data: blob:${web}`, "style-src 'unsafe-inline'", `font-src data:${web}`, "media-src 'none'", "frame-src 'none'", "form-action 'none'"].join("; ");
  const base = [
    `html{color-scheme:${scheme}}`,
    "html,body{margin:0;padding:0;background:transparent;overflow:hidden}",
    `body{color:${ink.fg};font-family:${ink.font};font-size:14px;line-height:1.5;overflow-wrap:break-word;-webkit-text-size-adjust:100%}`,
    "#mail{display:flow-root}",
    `a{color:${ink.link}}`,
    `blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:2px solid ${ink.rule}}`,
    "pre{white-space:pre-wrap}",
    "img{border:0;max-width:100%;height:auto}",
    "p{margin:0 0 .6em}",
  ].join("");
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="color-scheme" content="${scheme}">` +
    '<base target="_blank">' +
    `<style>${base}</style>` +
    `</head><body><div id="mail">${html}</div></body></html>`
  );
}

/** A computed `rgb()` or `rgba()` as channels, or null. */
function rgbOf(computed: string): Rgb | null {
  const m = /^rgba?\(([^)]*)\)$/.exec(computed.trim());
  const parts = m ? m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number) : [];
  return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? [parts[0]!, parts[1]!, parts[2]!] : null;
}

interface Palette {
  scheme: "light" | "dark";
  ink: EmailInk;
  /** Where white and black land when the surface is dark; null on a light one. */
  dark: DarkTheme | null;
}

/**
 * The token colours where the frame sits, resolved to values a document outside
 * the app can use. Read beside the frame, not on the page, so a region themed
 * on its own (a dark panel, the gallery's dark column) is honoured.
 */
function readInk(host: HTMLElement, fallback: "light" | "dark"): Palette {
  const probe = document.createElement("span");
  probe.className = "bg-card text-foreground border-border absolute invisible";
  const link = document.createElement("span");
  link.className = "text-accent-foreground absolute invisible";
  host.append(probe, link);
  try {
    const s = getComputedStyle(probe);
    /* Our web font cannot load inside the frame, so the system stack follows it. */
    const font = getComputedStyle(document.body).fontFamily;
    const ink = { fg: s.color, link: getComputedStyle(link).color, rule: s.borderTopColor || s.color, font: font ? `${font}, system-ui, sans-serif` : "system-ui, sans-serif" };
    const bg = rgbOf(s.backgroundColor);
    const fg = rgbOf(s.color);
    /* Dark when our card is dark: the colour decides, not a class or an attribute somewhere up the tree. */
    const scheme = bg ? (bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 < 128 ? "dark" : "light") : fallback;
    return { scheme, ink, dark: scheme === "dark" && bg && fg ? { bg, fg } : null };
  } finally {
    probe.remove();
    link.remove();
  }
}

/** The link the press landed on, inside the frame's own document. */
function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target as (Element & { closest?: (s: string) => Element | null }) | null;
  return el && typeof el.closest === "function" ? (el.closest("a[href]") as HTMLAnchorElement | null) : null;
}

export function EmailFrame({ html, title, remoteImages = false, onMailto, className }: EmailFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const { theme } = useTheme();
  const [palette, setPalette] = useState<Palette | null>(null);
  /* Read before the first paint, and again whenever the theme changes. */
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (host) setPalette(readInk(host, theme === "dark" ? "dark" : "light"));
  }, [theme]);
  const scheme = palette?.scheme ?? (theme === "dark" ? "dark" : "light");
  /* On a dark surface a message is recoloured as Outlook does; on a light one it is drawn as sent. */
  const body = useMemo(() => (palette?.dark ? recolourHtml(html, palette.dark) : html), [html, palette]);
  const doc = useMemo(() => (palette ? buildEmailDoc(body, { remoteImages, ink: palette.ink, scheme }) : ""), [body, remoteImages, palette, scheme]);
  /* Read through a ref, so a new handler from the parent does not reload the frame. */
  const mailto = useRef(onMailto);
  mailto.current = onMailto;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer: ResizeObserver | null = null;
    let detach: (() => void) | null = null;

    /* As tall as its content, so the conversation scrolls as one page; as wide as the column, scaled if it must be. */
    const fit = () => {
      const root = frame.contentDocument?.getElementById("mail");
      if (!root) return;
      root.style.transform = "";
      root.style.width = "";
      const room = frame.clientWidth;
      const natural = root.scrollWidth;
      if (room > 0 && natural > room + 1) {
        root.style.width = `${natural}px`;
        root.style.transformOrigin = "0 0";
        root.style.transform = `scale(${Math.max(MIN_SCALE, room / natural)})`;
      }
      const next = Math.max(16, Math.ceil(root.getBoundingClientRect().height));
      setHeight((h) => (h !== null && Math.abs(h - next) <= 1 ? h : next));
    };

    const attach = () => {
      detach?.();
      const inner = frame.contentDocument;
      if (!inner) return;
      const onClick = (e: MouseEvent) => {
        const a = anchorOf(e.target);
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        if (/^mailto:/i.test(href) && mailto.current) {
          e.preventDefault();
          mailto.current(parseMailto(href));
        } else if (href.startsWith("#")) {
          e.preventDefault();
          const id = href.slice(1);
          (inner.getElementById(id) ?? inner.getElementsByName(id)[0])?.scrollIntoView({ block: "start" });
        }
      };
      /* Images and fonts change the height once they arrive; their loads do not bubble, so they are caught on the way down. */
      inner.addEventListener("load", fit, true);
      inner.addEventListener("error", fit, true);
      inner.addEventListener("click", onClick, true);
      const root = inner.getElementById("mail");
      if (observer && root) observer.observe(root);
      detach = () => {
        inner.removeEventListener("load", fit, true);
        inner.removeEventListener("error", fit, true);
        inner.removeEventListener("click", onClick, true);
        if (observer && root) observer.unobserve(root);
      };
      fit();
    };

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => fit());
      observer.observe(frame);
    }
    frame.addEventListener("load", attach);
    if (frame.contentDocument?.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      detach?.();
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={ref}
      /* Named by aria-label, not title: a title is also a tooltip the browser draws (gate 21). */
      aria-label={title}
      srcDoc={doc}
      /* Same origin so the frame can be measured; popups so a link opens in a new tab; never scripts. */
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      scrolling="no"
      data-scheme={scheme}
      className={cn("block h-(--email-h) w-full border-0", scheme === "dark" ? "scheme-dark" : "scheme-light", className)}
      /* Until it has measured itself: tall enough to show it is there, short enough that a two-line reply does not jump the page. */
      style={{ "--email-h": `${height ?? 48}px` } as CSSProperties}
    />
  );
}
