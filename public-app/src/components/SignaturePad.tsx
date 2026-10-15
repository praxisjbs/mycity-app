import { useEffect, useImperativeHandle, useRef, forwardRef, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

export interface SignaturePadHandle {
  clear: () => void;
  /** The signature as a PNG data URL, or null when nothing has been drawn. */
  toPng: () => string | null;
}

/**
 * A signature drawn with a finger or a mouse (MILESTONES §10: "signs on a
 * canvas from a phone"). The pad is paper in both themes, with dark ink, because
 * the image is stamped into the execution block of a white PDF.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange: (hasInk: boolean) => void; disabled?: boolean; label: string }>(function SignaturePad({ onChange, disabled, label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  /*
   * Size the bitmap to the box and the screen's pixel density, so the line is
   * crisp. A resize (a phone turned on its side, a scrollbar appearing) keeps
   * what is already drawn, scaled to the new box.
   */
  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (!w || !h || (c.width === w && c.height === h)) return;
      let keep: HTMLCanvasElement | null = null;
      if (inked.current && c.width && c.height) {
        keep = document.createElement("canvas");
        keep.width = c.width;
        keep.height = c.height;
        keep.getContext("2d")!.drawImage(c, 0, 0);
      }
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      if (keep) ctx.drawImage(keep, 0, 0, keep.width, keep.height, 0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = getComputedStyle(c).color;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked.current) {
      inked.current = true;
      onChange(true);
    }
  };
  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  useImperativeHandle(ref, () => ({
    clear() {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
      inked.current = false;
      onChange(false);
    },
    toPng: () => (inked.current ? canvas.current!.toDataURL("image/png") : null),
  }));

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className={cn("sig-pad block h-24 w-full rounded-[10px] border-[1.5px] border-dashed border-paper-dash bg-paper text-paper-heading", disabled ? "cursor-default opacity-60" : "cursor-crosshair")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
    />
  );
});
