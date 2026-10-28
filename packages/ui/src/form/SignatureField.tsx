/**
 * @component SignatureField
 * @group Forms
 * @summary A signature drawn with a finger or a mouse, which leaves as a PNG for the document it is stamped into.
 * @use Signing an offer, an acknowledgement, a policy, an asset handover (MILESTONES §10: signed on a canvas from a phone).
 * @avoid A typed name as a signature; keeping the image anywhere but the document it belongs to; a pad nobody can clear.
 * @phone This is where it is used most: the pad is full width and drawn with a finger, and Clear is a 44 px target.
 * @a11y The pad is named, and Clear says whether anything has been drawn, so the state is never only visual; a typed-name fallback stays the screen's choice.
 * @status stable
 * @example <SignatureField label="Your Signature" onChange={setInk} ref={pad} initial={saved} />
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type PointerEvent } from "react";
import { cn } from "../lib/cn";
import { Button } from "../actions/Button";

/** What the screen asks the pad for when the form is sent. */
export interface SignatureFieldHandle {
  /** Wipes the pad. */
  clear: () => void;
  /** The signature as a PNG data URL, or null when nothing has been drawn. */
  toPng: () => string | null;
}

export interface SignatureFieldProps {
  /** Names the pad, Title Case, at most 4 words. */
  label: string;
  /** Called true the moment the first stroke lands, and false when it is cleared. */
  onChange: (hasInk: boolean) => void;
  /** Nothing can be drawn (the document is already signed, or the link has been used). */
  disabled?: boolean;
  /** Hide the Clear button, where the screen offers its own. */
  noClear?: boolean;
  /**
   * A signature the person saved before, as a PNG data URL: drawn on the pad as its ink when it
   * opens, so they need not draw again. Clear Signature wipes it; drawing adds to it.
   */
  initial?: string | null;
  /** Layout classes only (spacing, height). */
  className?: string;
}

/** The ink's width, in CSS pixels, before the screen's own density is applied. */
const STROKE = 2.2;

/**
 * Lay the paper into the bitmap itself, across the whole pad. A browser that darkens every site
 * repaints the canvas's CSS background but never its pixels, so paper drawn there stays white
 * under the dark ink; the PNG carries it, white on the white page it is stamped into.
 */
function paper(pad: HTMLCanvasElement, ink: CanvasRenderingContext2D) {
  ink.save();
  ink.setTransform(1, 0, 0, 1, 0, 0);
  ink.fillStyle = getComputedStyle(pad).backgroundColor;
  ink.fillRect(0, 0, pad.width, pad.height);
  ink.restore();
}

export const SignatureField = forwardRef<SignatureFieldHandle, SignatureFieldProps>(function SignatureField({ label, onChange, disabled, noClear, initial, className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  /*
   * Size the bitmap to the box and the screen's pixel density, so the line is
   * crisp rather than blurred. A resize (a phone turned on its side, a
   * scrollbar appearing) keeps what is already drawn, scaled to the new box.
   */
  useEffect(() => {
    const pad = canvas.current;
    if (!pad) return;
    const fit = () => {
      const box = pad.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(box.width * ratio);
      const height = Math.round(box.height * ratio);
      if (!width || !height || (pad.width === width && pad.height === height)) return;
      let keep: HTMLCanvasElement | null = null;
      if (inked.current && pad.width && pad.height) {
        keep = document.createElement("canvas");
        keep.width = pad.width;
        keep.height = pad.height;
        keep.getContext("2d")?.drawImage(pad, 0, 0);
      }
      pad.width = width;
      pad.height = height;
      const ink = pad.getContext("2d");
      if (!ink) return;
      paper(pad, ink);
      if (keep) ink.drawImage(keep, 0, 0, keep.width, keep.height, 0, 0, width, height);
      ink.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink.lineCap = "round";
      ink.lineJoin = "round";
      ink.lineWidth = STROKE;
      ink.strokeStyle = getComputedStyle(pad).color;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(pad);
    return () => watch.disconnect();
  }, []);

  /* The saved signature, fitted inside the pad and centred, as ink. Once per image. */
  const drawn = useRef<string | null>(null);
  useEffect(() => {
    const pad = canvas.current;
    if (!pad || !initial || drawn.current === initial) return;
    drawn.current = initial;
    const image = new Image();
    image.onload = () => {
      const ink = pad.getContext("2d");
      if (!ink || !image.width || !image.height) return;
      const box = pad.getBoundingClientRect();
      const scale = Math.min(box.width / image.width, box.height / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      ink.drawImage(image, (box.width - w) / 2, (box.height - h) / 2, w, h);
      inked.current = true;
      onChange(true);
    };
    image.src = initial;
  }, [initial, onChange]);

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    canvas.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = at(e);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ink = canvas.current?.getContext("2d");
    if (!ink) return;
    const now = at(e);
    ink.beginPath();
    ink.moveTo(last.current.x, last.current.y);
    ink.lineTo(now.x, now.y);
    ink.stroke();
    last.current = now;
    if (!inked.current) {
      inked.current = true;
      onChange(true);
    }
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const wipe = () => {
    const pad = canvas.current;
    const ink = pad?.getContext("2d");
    if (!pad || !ink) return;
    paper(pad, ink);
    inked.current = false;
    onChange(false);
  };

  useImperativeHandle(ref, () => ({
    clear: wipe,
    toPng: () => (inked.current ? (canvas.current?.toDataURL("image/png") ?? null) : null),
  }));

  return (
    <div className={className}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        /*
         * Paper in both themes with dark ink: the image is stamped into the
         * execution block of a white PDF, so it is never drawn in the theme's
         * own foreground colour. The bitmap carries the paper too (paper()).
         */
        className={cn(
          "block h-24 w-full touch-none rounded-box border border-dashed border-paper-dash bg-paper text-paper-heading",
          disabled ? "cursor-default opacity-60" : "cursor-crosshair",
        )}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
      />
      {!noClear && (
        <div className="mt-1.5 flex justify-end">
          <Button size="sm" icon="refresh" onClick={wipe} disabled={disabled}>
            Clear Signature
          </Button>
        </div>
      )}
    </div>
  );
});
