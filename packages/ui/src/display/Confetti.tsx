/**
 * @component Confetti
 * @group Display
 * @summary A short burst of paper or stars from a celebration card, drawn on a canvas inside it, that settles and stops.
 * @use Behind a birthday or a work anniversary card in the Staff Community: once the first time a person sees the card, and from Celebrate each time they press it (community.md §3 step 3).
 * @avoid A saved form, a completed task or anything a person does many times a day; anything that should keep moving (it bursts and settles).
 * @phone The same burst, sized to the card; nothing reaches outside the card.
 * @a11y Decorative and hidden from screen readers; under prefers-reduced-motion it never draws.
 * @status stable
 * @example <Confetti burst={presses} from={celebrateRef} />
 * @example <Confetti shape="stars" on="brand" burstOnView onViewBurst={remember} viewFrom={medalRef} />
 */
import { useEffect, useRef, type RefObject } from "react";
import { cn } from "../lib/cn";

export interface ConfettiProps {
  /** `paper` (rectangles, dots and ribbons, the default) for a birthday; `stars` for an anniversary. */
  shape?: "paper" | "stars";
  /** What the pieces fly over: `card` (the default) takes the yellow and the chart colours; `brand`, on City Green, the yellows and white. */
  on?: "card" | "brand";
  /** Fires one burst each time it changes to a new number above 0: pass a count of presses. */
  burst?: number;
  /** Where a `burst` comes from (the Celebrate button); without it, the top of the box. */
  from?: RefObject<HTMLElement | null>;
  /** Bursts once, the first time the box is well in view (60 %). */
  burstOnView?: boolean;
  /** Where the view burst comes from (the person's photo, the medal); without it, the top of the box. */
  viewFrom?: RefObject<HTMLElement | null>;
  /** Called once the box has been well in view, so the screen can remember the card was seen. */
  onViewBurst?: () => void;
  /** Layout classes only; the canvas fills its positioned parent, behind its content. */
  className?: string;
}

type Kind = "rect" | "circle" | "ribbon" | "star";

/** The pieces each shape throws, picked at random per piece. */
const KINDS: Record<NonNullable<ConfettiProps["shape"]>, readonly Kind[]> = {
  paper: ["rect", "rect", "circle", "ribbon"],
  stars: ["star", "star", "star", "rect"],
};

/** The colours, as token names, read from the canvas so they follow the theme and the palette. */
const INKS: Record<NonNullable<ConfettiProps["on"]>, readonly string[]> = {
  card: ["--primary", "--chart-1", "--chart-2", "--chart-4", "--chart-5"],
  brand: ["--primary", "--primary-tint", "--on-deep", "--on-deep-soft"],
};

/** How many pieces the view burst throws; a press throws fewer. Enough to read as a celebration, few enough to stay cheap. */
const PIECES = 56;
const PRESS_PIECES = 34;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  turn: number;
  spin: number;
  flip: number;
  flipRate: number;
  sway: number;
  size: number;
  ink: string;
  kind: Kind;
}

interface Engine {
  fire: (x: number, y: number, count: number, power: number, kinds: readonly Kind[], inks: readonly string[]) => void;
  stop: () => void;
}

const prefersStill = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, p: Piece) {
  const z = p.size;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.turn);
  ctx.fillStyle = ctx.strokeStyle = p.ink;
  if (p.kind === "rect") {
    ctx.scale(1, Math.cos(p.flip));
    ctx.fillRect(-z / 2, -z * 0.32, z, z * 0.64);
  } else if (p.kind === "circle") {
    ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.flip)));
    ctx.beginPath();
    ctx.arc(0, 0, z * 0.38, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "ribbon") {
    const bend = Math.sin(p.flip) * z * 0.8;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-z, 0);
    ctx.quadraticCurveTo(-z / 2, bend, 0, 0);
    ctx.quadraticCurveTo(z / 2, -bend, z, 0);
    ctx.stroke();
  } else {
    ctx.scale(0.5 + 0.5 * Math.abs(Math.cos(p.flip)), 1);
    star(ctx, z * 0.66);
  }
  ctx.restore();
}

/** The pieces in flight on one canvas, drawn a frame at a time until the last has fallen out of the box. */
function engineFor(canvas: HTMLCanvasElement): Engine | null {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const c = ctx;
  let pieces: Piece[] = [];
  let frame = 0;
  let last = 0;
  let w = 0;
  let h = 0;

  const fit = () => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = box.width;
    h = box.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const tick = (now: number) => {
    // Steps are measured in 60ths of a second, so a 120 Hz screen falls at the same pace.
    const dt = Math.min(2.5, (now - last) / 16.667);
    last = now;
    c.clearRect(0, 0, w, h);
    for (const p of pieces) {
      const drag = Math.pow(0.965, dt);
      p.vx *= drag;
      p.vy = p.vy * drag + 0.17 * dt;
      // Once falling, paper flutters down at its own pace instead of dropping.
      if (p.vy > 2.3) {
        p.vy = 2.3;
        p.sway += 0.05 * dt;
        p.x += Math.sin(p.sway) * 0.7 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.turn += p.spin * dt;
      p.flip += p.flipRate * dt;
      draw(c, p);
    }
    pieces = pieces.filter((p) => p.y < h + 24 && p.x > -40 && p.x < w + 40);
    frame = pieces.length ? requestAnimationFrame(tick) : 0;
  };

  return {
    fire(x, y, count, power, kinds, inks) {
      fit();
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const speed = (2.6 + Math.random() * 6) * power;
        pieces.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          turn: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.22,
          flip: Math.random() * Math.PI * 2,
          flipRate: 0.05 + Math.random() * 0.1,
          sway: Math.random() * Math.PI * 2,
          size: 5 + Math.random() * 4,
          ink: pick(inks),
          kind: pick(kinds),
        });
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pieces = [];
    },
  };
}

export function Confetti({ shape = "paper", on = "card", burst = 0, from, burstOnView = false, viewFrom, onViewBurst, className }: ConfettiProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const pressed = useRef(burst);
  const seen = useRef(onViewBurst);
  seen.current = onViewBurst;

  /* Nothing is measured or drawn until the first burst. */
  const fire = (origin: HTMLElement | null | undefined, count: number, power: number) => {
    const el = canvas.current;
    if (!el || prefersStill()) return;
    engine.current ??= engineFor(el);
    if (!engine.current) return;
    const box = el.getBoundingClientRect();
    const o = origin?.getBoundingClientRect();
    const x = o ? o.left - box.left + o.width / 2 : box.width / 2;
    const y = o ? o.top - box.top + o.height / 2 : box.height / 4;
    const style = getComputedStyle(el);
    const inks = INKS[on].map((name) => style.getPropertyValue(name).trim()).filter(Boolean);
    engine.current.fire(x, y, count, power, KINDS[shape], inks.length ? inks : [style.color]);
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  useEffect(() => () => engine.current?.stop(), []);

  useEffect(() => {
    if (burst > 0 && burst !== pressed.current) fireRef.current(from?.current, PRESS_PIECES, 0.85);
    pressed.current = burst;
  }, [burst, from]);

  useEffect(() => {
    const box = canvas.current?.parentElement;
    if (!burstOnView || !box || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.intersectionRatio >= 0.6)) return;
        io.disconnect();
        fireRef.current(viewFrom?.current, PIECES, 1);
        seen.current?.();
      },
      { threshold: [0.6] },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [burstOnView, viewFrom]);

  return <canvas ref={canvas} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 size-full", className)} />;
}
