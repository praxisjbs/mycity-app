/**
 * The drawing half of CityShowcase: one scene per city, drawn in the scene
 * tokens (tokens.css "city scenes") and lit by the city's own clock. The sky
 * follows the sun, worked out from the city's latitude and the day of the
 * year, so London is dark at five in December while Lagos is still bright.
 * Lazily loaded: the sign-in screen paints Deep Green first and the scenes
 * fade in over it.
 *
 * Every scene is a 1600 × 900 drawing anchored to the bottom edge and cropped
 * to fill (preserveAspectRatio slice). Layers, back to front: sky, stars, sun
 * or moon, clouds, the far skyline, the landmarks, water or ground, the
 * foreground. Motion (drifting clouds, twinkling windows, the London Eye
 * turning, a grazing giraffe) stops when `still` is set.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type CityKey = "lagos" | "london" | "accra" | "nairobi";
export type Phase = "night" | "dawn" | "day" | "dusk";

/** Latitude and longitude, for the sun. */
const PLACE: Record<CityKey, { lat: number; lon: number }> = {
  lagos: { lat: 6.45, lon: 3.39 },
  london: { lat: 51.51, lon: -0.13 },
  accra: { lat: 5.6, lon: -0.19 },
  nairobi: { lat: -1.29, lon: 36.82 },
};

/** Sunrise and sunset in the city's local hours, from the day of the year (accurate to a few minutes). */
export function sunTimes(city: CityKey, now: Date, offsetHours: number): { rise: number; set: number } {
  const { lat, lon } = PLACE[city];
  const day = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86_400_000);
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365) * rad;
  const cos = -Math.tan(lat * rad) * Math.tan(decl);
  const half = (Math.acos(Math.min(1, Math.max(-1, cos))) / rad) / 15;
  const noon = 12 + (offsetHours * 15 - lon) / 15;
  return { rise: noon - half, set: noon + half };
}

/** The light at this hour: dawn and dusk are the hour or so around sunrise and sunset. */
export function phaseOf(hour: number, rise: number, set: number): Phase {
  if (hour >= rise - 0.5 && hour < rise + 0.75) return "dawn";
  if (hour >= rise + 0.75 && hour < set - 0.75) return "day";
  if (hour >= set - 0.75 && hour < set + 0.6) return "dusk";
  return "night";
}

const SKY: Record<Phase, string> = {
  night: "from-scene-night-top to-scene-night-bottom",
  dawn: "from-scene-dawn-top to-scene-dawn-bottom",
  day: "from-scene-day-top to-scene-day-bottom",
  dusk: "from-scene-dusk-top to-scene-dusk-bottom",
};

/* ───── helpers ───── */

/** A repeatable random sequence, so a city is drawn the same on every visit. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A row of towers between two x positions, standing on `base`. */
function towers(seed: number, from: number, to: number, base: number, [minH, maxH]: [number, number], [minW, maxW]: [number, number], gap = 4): Box[] {
  const r = seeded(seed);
  const out: Box[] = [];
  for (let x = from; x < to; ) {
    const w = Math.round(minW + r() * (maxW - minW));
    const h = Math.round(minH + r() ** 1.6 * (maxH - minH));
    out.push({ x, y: base - h, w, h });
    x += w + Math.round(r() * gap * 3) - gap;
  }
  return out;
}

/** Lit windows on a set of towers: a share of a 12 × 16 grid on each. */
function windowsOf(seed: number, boxes: Box[], share: number): Box[] {
  const r = seeded(seed);
  const out: Box[] = [];
  for (const b of boxes) {
    const cols = Math.max(1, Math.floor((b.w - 8) / 12));
    const rows = Math.floor((b.h - 18) / 16);
    const left = b.x + (b.w - cols * 12) / 2 + 3;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (r() < share) out.push({ x: left + j * 12, y: b.y + 12 + i * 16, w: 6, h: 8 });
  }
  return out;
}

const delay = (i: number, spread = 3.4): CSSProperties => ({ animationDelay: `${-((i * 0.731) % 1) * spread}s` });

function Blocks({ boxes, className }: { boxes: Box[]; className: string }) {
  return (
    <g className={className}>
      {boxes.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h + 2} />
      ))}
    </g>
  );
}

/** Lit windows, one in seven twinkling; by day the same panes catch the light faintly. */
function Windows({ boxes, lit, still }: { boxes: Box[]; lit: boolean; still: boolean }) {
  if (!lit) {
    return (
      <g className="fill-scene-glint" opacity={0.14}>
        {boxes.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} />
        ))}
      </g>
    );
  }
  return (
    <g className="fill-scene-window">
      {boxes.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={1} opacity={0.55 + ((i * 37) % 45) / 100} className={cn(!still && i % 7 === 0 && "animate-twinkle")} style={i % 7 === 0 ? delay(i, 6) : undefined} />
      ))}
    </g>
  );
}

function Stars({ still }: { still: boolean }) {
  const stars = useMemo(() => {
    const r = seeded(7);
    return Array.from({ length: 70 }, () => ({ x: r() * 1600, y: r() * 430, s: 0.6 + r() * 1.5 }));
  }, []);
  return (
    <g className="fill-scene-light">
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.s} className={cn(!still && i % 3 === 0 && "animate-twinkle")} style={i % 3 === 0 ? delay(i) : undefined} opacity={0.75} />
      ))}
    </g>
  );
}

/**
 * The sun by day, the moon by night, on an arc across the open sky in the
 * middle of the picture: clear of the headline at the left and the sign-in
 * card at the right.
 */
function Sky({ phase, hour, rise, set, horizon }: { phase: Phase; hour: number; rise: number; set: number; horizon: number }) {
  const day = hour >= rise && hour <= set;
  const light = set - rise;
  const t = day ? (hour - rise) / light : ((hour - set + 24) % 24) / (24 - light);
  const x = 600 + t * 460;
  const y = horizon - Math.sin(Math.PI * t) * (horizon - 120) + 10;
  if (day || phase === "dawn" || phase === "dusk") {
    return (
      <g className="fill-scene-sun">
        <circle cx={x} cy={y} r={170} opacity={phase === "day" ? 0.08 : 0.16} />
        <circle cx={x} cy={y} r={95} opacity={phase === "day" ? 0.12 : 0.22} />
        <circle cx={x} cy={y} r={44} opacity={phase === "day" ? 0.95 : 0.9} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={x} cy={y} r={120} className="fill-scene-moon" opacity={0.06} />
      <circle cx={x} cy={y} r={30} className="fill-scene-moon" opacity={0.95} />
      <circle cx={x + 12} cy={y - 8} r={26} className="fill-scene-night-top" opacity={0.55} />
    </g>
  );
}

function Clouds({ phase, still }: { phase: Phase; still: boolean }) {
  const clouds: Array<[number, number, number, number]> = [
    [140, 0.9, 0, 140],
    [250, 0.7, 48, 180],
    [90, 0.55, 95, 220],
  ];
  return (
    <g className="fill-scene-light" opacity={phase === "day" ? 0.5 : phase === "night" ? 0.07 : 0.22}>
      {clouds.map(([y, s, d, dur], i) => (
        <g key={i} className={cn("transform-view", !still && "animate-cloud")} style={{ animationDelay: `${-d}s`, animationDuration: `${dur}s` }}>
          <path transform={`translate(${200 + i * 520} ${y}) scale(${s})`} d="M0 40 Q 10 10 50 14 Q 70 -12 112 6 Q 150 -4 166 26 Q 206 26 206 52 L 0 52 Z" />
        </g>
      ))}
    </g>
  );
}

/** Water from the horizon down: its body, a sheen under the sky, and glints that drift. */
function Water({ horizon, lit, still }: { horizon: number; lit: boolean; still: boolean }) {
  const glints = useMemo(() => {
    const r = seeded(horizon);
    return Array.from({ length: 26 }, () => ({ x: r() * 1500, y: horizon + 10 + r() ** 1.4 * (890 - horizon), w: 30 + r() * 120 }));
  }, [horizon]);
  return (
    <g>
      <rect x={0} y={horizon} width={1600} height={900 - horizon} className="fill-scene-water" />
      <rect x={0} y={horizon} width={1600} height={6} className="fill-scene-glint" opacity={0.25} />
      <g className={lit ? "fill-scene-window" : "fill-scene-glint"}>
        {glints.map((g, i) => (
          <rect key={i} x={g.x} y={g.y} width={g.w} height={2} rx={1} opacity={0.45} className={cn("transform-view", !still && "animate-ripple")} style={delay(i, 7)} />
        ))}
      </g>
    </g>
  );
}

/** A palm, rising from the bottom edge; its crown sways. */
function Palm({ x, top, lean = 1, scale = 1, still }: { x: number; top: number; lean?: number; scale?: number; still: boolean }) {
  const tx = x + lean * 60 * scale;
  const fronds = [-160, -130, -100, -70, -35, 0, 30, 60];
  return (
    <g className="fill-scene-near">
      <path d={`M${x - 14 * scale} 905 Q ${x + lean * 10} ${(905 + top) / 2} ${tx - 5 * scale} ${top} L ${tx + 5 * scale} ${top} Q ${x + lean * 26 * scale} ${(905 + top) / 2} ${x + 14 * scale} 905 Z`} />
      <g className={cn("transform-fill origin-bottom", !still && "animate-sway")}>
        {fronds.map((a, i) => (
          <path key={i} transform={`translate(${tx} ${top}) rotate(${a}) scale(${scale})`} d="M0 0 Q 70 -38 150 12 Q 72 -14 0 6 Z" />
        ))}
        <circle cx={tx} cy={top + 4} r={10 * scale} />
      </g>
    </g>
  );
}

/* ───── the cities ───── */

interface Art {
  lit: boolean;
  still: boolean;
  hour: number;
}

/** The two Lagos towers drawn by hand: the one with the mast, and the round-topped one. */
const LAGOS_TOWERS: Box[] = [
  { x: 330, y: 330, w: 74, h: 370 },
  { x: 540, y: 380, w: 86, h: 320 },
];

function Lagos({ lit, still }: Art) {
  const far = useMemo(() => towers(11, -20, 1620, 700, [40, 170], [30, 70]), []);
  const mid = useMemo(() => towers(12, 90, 700, 700, [110, 300], [44, 92], 2), []);
  const win = useMemo(() => windowsOf(13, [...mid, ...LAGOS_TOWERS], 0.22), [mid]);
  const cables = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <>
      <Blocks boxes={far} className="fill-scene-far" />
      <g className="fill-scene-mid">
        <Blocks boxes={mid} className="" />
        <rect x={330} y={330} width={74} height={372} />
        <rect x={363} y={250} width={6} height={82} />
        <path d="M540 702 L540 400 Q 583 352 626 400 L626 702 Z" />
        {/* The Link Bridge: one pylon, cables fanned to the deck. */}
        <rect x={660} y={634} width={940} height={12} />
        {[700, 780, 860, 1180, 1260, 1340, 1420, 1500].map((x) => (
          <rect key={x} x={x} y={644} width={10} height={58} />
        ))}
        <path d="M996 702 L1002 430 L1018 430 L1024 702 Z" />
      </g>
      <g className="stroke-scene-mid" strokeWidth={1.6}>
        {cables.map((i) => (
          <line key={`l${i}`} x1={1010} y1={440 + i * 12} x2={978 - (i + 1) * 30} y2={636} />
        ))}
        {cables.map((i) => (
          <line key={`r${i}`} x1={1010} y1={440 + i * 12} x2={1042 + (i + 1) * 30} y2={636} />
        ))}
      </g>
      <Windows boxes={win} lit={lit} still={still} />
      {lit && (
        <g className="fill-scene-window">
          {[700, 760, 820, 880, 940, 1080, 1140, 1200, 1260, 1320, 1380, 1440, 1500, 1560].map((x) => (
            <circle key={x} cx={x} cy={632} r={2.4} />
          ))}
          <circle cx={1010} cy={428} r={3.5} className={cn(!still && "animate-twinkle")} />
        </g>
      )}
      <Water horizon={700} lit={lit} still={still} />
      <Palm x={70} top={520} lean={1} scale={1.1} still={still} />
      <Palm x={170} top={600} lean={-0.6} scale={0.8} still={still} />
      <Palm x={1540} top={540} lean={-1} scale={1} still={still} />
    </>
  );
}

function London({ lit, still, hour }: Art) {
  const far = useMemo(() => towers(21, -20, 1620, 690, [40, 150], [30, 80]), []);
  const minutes = (hour % 1) * 60;
  const hAngle = ((hour % 12) / 12) * 360;
  const mAngle = (minutes / 60) * 360;
  const spokes = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
  const pods = Array.from({ length: 32 }, (_, i) => (i / 32) * Math.PI * 2);
  const pinnacles = Array.from({ length: 26 }, (_, i) => 236 + i * 16);
  return (
    <>
      <g className="fill-scene-far">
        <Blocks boxes={far} className="" />
        {/* The Shard and the Gherkin, in the haze. */}
        <path d="M1192 690 L1242 196 L1250 196 L1300 690 Z" />
        <path d="M1098 690 L1098 520 Q 1102 432 1128 418 Q 1154 432 1158 520 L1158 690 Z" />
      </g>
      <g className="fill-scene-mid">
        {/* The Palace of Westminster and Victoria Tower. */}
        <rect x={220} y={604} width={420} height={88} />
        {pinnacles.map((x) => (
          <path key={x} d={`M${x} 606 L${x + 4} 586 L${x + 8} 606 Z`} />
        ))}
        <rect x={160} y={420} width={78} height={272} />
        {[160, 182, 204, 226].map((x) => (
          <path key={x} d={`M${x} 422 L${x + 6} 392 L${x + 12} 422 Z`} />
        ))}
        {/* Elizabeth Tower. */}
        <rect x={612} y={380} width={56} height={312} />
        <rect x={604} y={296} width={72} height={86} />
        <rect x={614} y={262} width={52} height={36} />
        <path d="M606 264 L640 168 L674 264 Z" />
        <rect x={638} y={146} width={4} height={24} />
        {/* Westminster Bridge. */}
        <rect x={676} y={652} width={430} height={12} />
        {[700, 770, 840, 910, 980, 1050].map((x) => (
          <rect key={x} x={x} y={662} width={14} height={30} />
        ))}
        {/* The London Eye's legs and hub. */}
        <path d="M899 470 L849 692 L861 692 L903 488 Z M899 470 L955 692 L967 692 L911 476 Z" />
      </g>
      {/* The clock face shows London's time. */}
      <g>
        <circle cx={640} cy={339} r={27} className={lit ? "fill-scene-window" : "fill-scene-light"} opacity={lit ? 0.9 : 0.85} />
        <g className="stroke-scene-near" strokeLinecap="round">
          <line x1={640} y1={339} x2={640} y2={324} strokeWidth={3.2} transform={`rotate(${hAngle} 640 339)`} />
          <line x1={640} y1={339} x2={640} y2={317} strokeWidth={2} transform={`rotate(${mAngle} 640 339)`} />
        </g>
      </g>
      <g className={cn("transform-fill origin-center", !still && "animate-turn")}>
        <circle cx={905} cy={470} r={196} className="fill-none stroke-scene-mid" strokeWidth={5} />
        <circle cx={905} cy={470} r={184} className="fill-none stroke-scene-mid" strokeWidth={2} />
        <g className="stroke-scene-mid" strokeWidth={1.2}>
          {spokes.map((a, i) => (
            <line key={i} x1={905} y1={470} x2={905 + Math.cos(a) * 184} y2={470 + Math.sin(a) * 184} />
          ))}
        </g>
        <g className={lit ? "fill-scene-window" : "fill-scene-mid"}>
          {pods.map((a, i) => (
            <ellipse key={i} cx={905 + Math.cos(a) * 203} cy={470 + Math.sin(a) * 203} rx={7} ry={5} />
          ))}
        </g>
      </g>
      <circle cx={905} cy={470} r={11} className="fill-scene-mid" />
      <Water horizon={690} lit={lit} still={still} />
      {/* Embankment lamps. */}
      <g className="fill-scene-near">
        <rect x={0} y={858} width={1600} height={42} />
        {[90, 420, 1330].map((x) => (
          <g key={x}>
            <rect x={x - 3} y={760} width={6} height={100} />
            <rect x={x - 10} y={740} width={20} height={22} rx={3} />
            <path d={`M${x - 12} 742 L${x} 728 L${x + 12} 742 Z`} />
          </g>
        ))}
      </g>
      {lit && (
        <g className="fill-scene-window">
          {[90, 420, 1330].map((x) => (
            <g key={x}>
              <circle cx={x} cy={751} r={40} opacity={0.12} />
              <rect x={x - 6} y={745} width={12} height={12} opacity={0.95} />
            </g>
          ))}
        </g>
      )}
    </>
  );
}

function Accra({ lit, still }: Art) {
  const far = useMemo(() => towers(31, 820, 1620, 705, [40, 180], [30, 80]), []);
  const mid = useMemo(() => towers(32, 1150, 1600, 705, [120, 290], [44, 90], 2), []);
  const win = useMemo(() => windowsOf(33, mid, 0.2), [mid]);
  const star = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 48 : 20;
    return `${490 + Math.cos(a) * r},${404 + Math.sin(a) * r}`;
  }).join(" ");
  return (
    <>
      <Blocks boxes={far} className="fill-scene-far" />
      <g className="fill-scene-mid">
        {/* Independence Arch: three arches under an attic, the Black Star on top. */}
        <path
          fillRule="evenodd"
          d="M232 705 L232 482 L748 482 L748 705 Z
             M390 705 L390 600 Q 490 520 590 600 L590 705 Z
             M268 705 L268 630 Q 312 586 356 630 L356 705 Z
             M624 705 L624 630 Q 668 586 712 630 L712 705 Z"
        />
        <rect x={218} y={460} width={544} height={24} />
        <rect x={440} y={448} width={100} height={14} />
        {/* Independence Square's stands. */}
        <path d="M770 705 L770 660 Q 950 610 1140 650 L1140 705 Z" />
        <Blocks boxes={mid} className="" />
        <path d="M1290 705 L1290 300 L1352 268 L1352 705 Z" />
      </g>
      <polygon points={star} className={cn("fill-scene-near stroke-scene-window")} strokeWidth={3} strokeLinejoin="round" />
      <Windows boxes={win} lit={lit} still={still} />
      <Water horizon={705} lit={lit} still={still} />
      {/* Surf along the beach. */}
      <g className="fill-scene-light" opacity={0.28}>
        <path d="M0 842 Q 200 826 400 842 T 800 842 T 1200 842 T 1600 842 L1600 852 L0 852 Z" className={cn("transform-view", !still && "animate-ripple")} />
      </g>
      <rect x={0} y={850} width={1600} height={50} className="fill-scene-near" />
      <Palm x={60} top={500} lean={1} scale={1.15} still={still} />
      <Palm x={1440} top={560} lean={-0.8} scale={0.9} still={still} />
      <Palm x={1560} top={480} lean={-1} scale={1.15} still={still} />
    </>
  );
}

/** Times Tower, Britam Tower and KICC, for their windows. */
const NAIROBI_TOWERS: Box[] = [
  { x: 470, y: 286, w: 70, h: 456 },
  { x: 838, y: 300, w: 64, h: 442 },
  { x: 615, y: 330, w: 60, h: 412 },
];

function Nairobi({ lit, still }: Art) {
  const far = useMemo(() => towers(41, 200, 1500, 742, [60, 220], [30, 80]), []);
  const mid = useMemo(() => towers(42, 300, 1060, 742, [110, 260], [40, 84], 2), []);
  const win = useMemo(() => windowsOf(43, [...mid, ...NAIROBI_TOWERS], 0.2), [mid]);
  const grass = useMemo(() => {
    const r = seeded(44);
    return Array.from({ length: 90 }, (_, i) => ({ x: i * 18 + r() * 10, h: 10 + r() * 22 }));
  }, []);
  return (
    <>
      <Blocks boxes={far} className="fill-scene-far" />
      <g className="fill-scene-mid">
        <Blocks boxes={mid} className="" />
        {/* Times Tower. */}
        <rect x={470} y={286} width={70} height={458} />
        {/* KICC: the round tower, its crown, and the cone of the plenary hall. */}
        <rect x={615} y={330} width={60} height={414} rx={6} />
        <ellipse cx={645} cy={326} rx={70} ry={13} />
        <path d="M618 326 Q 645 296 672 326 Z" />
        <path d="M688 744 L730 652 Q 762 636 794 652 L836 744 Z" />
        {/* Britam Tower, its prism top. */}
        <path d="M838 744 L838 300 L902 252 L902 744 Z" />
      </g>
      <Windows boxes={win} lit={lit} still={still} />
      {/* The park: grass, acacias, a giraffe. */}
      <g className="fill-scene-near">
        <rect x={0} y={740} width={1600} height={160} />
        {grass.map((g, i) => (
          <path key={i} d={`M${g.x} 742 L${g.x + 4} ${742 - g.h} L${g.x + 8} 742 Z`} />
        ))}
        <path d="M232 900 L238 640 Q 210 600 170 590 L178 584 Q 222 590 246 628 Q 262 600 300 590 L304 596 Q 270 610 254 646 L260 900 Z" />
        <path d="M80 600 Q 120 548 230 556 Q 340 540 410 590 Q 330 610 240 600 Q 140 612 80 600 Z" />
        <path d="M1376 900 L1382 620 Q 1350 586 1306 578 L1312 572 Q 1362 578 1390 612 Q 1410 586 1450 576 L1454 582 Q 1418 598 1400 630 L1406 900 Z" />
        <path d="M1220 586 Q 1270 528 1390 536 Q 1520 522 1590 576 Q 1500 596 1390 584 Q 1290 598 1220 586 Z" />
        {/* The giraffe: legs, body and tail; the neck lowers now and then to graze. */}
        <g transform="translate(930 0)">
          <rect x={0} y={652} width={8} height={100} />
          <rect x={16} y={656} width={8} height={96} />
          <rect x={72} y={644} width={8} height={108} />
          <rect x={88} y={640} width={8} height={112} />
          <path d="M-6 662 Q -8 626 30 622 L86 606 Q 112 604 108 640 Q 100 668 60 666 L4 672 Z" />
          <path d="M-4 640 Q -20 660 -24 690" className="fill-none stroke-scene-near" strokeWidth={3} />
          <g className={cn("transform-fill origin-bottom-left", !still && "animate-graze")}>
            <path d="M84 618 L112 500 L126 472 L140 476 L134 498 L106 620 Z" />
            <path d="M118 478 Q 132 456 158 466 L166 476 Q 150 486 132 488 Z" />
            <rect x={122} y={452} width={3} height={18} />
            <rect x={130} y={454} width={3} height={16} />
          </g>
        </g>
      </g>
    </>
  );
}

const ART: Record<CityKey, (a: Art) => ReactNode> = { lagos: Lagos, london: London, accra: Accra, nairobi: Nairobi };
const HORIZON: Record<CityKey, number> = { lagos: 700, london: 690, accra: 705, nairobi: 742 };

export interface CitySceneProps {
  city: CityKey;
  /** The city's local hour, minutes as a fraction. */
  hour: number;
  /** The city's offset from UTC in hours, for its sun. */
  offset: number;
  now: Date;
  active: boolean;
  still: boolean;
}

/** One city, filling its parent; fades in when active. */
export function CityScene({ city, hour, offset, now, active, still }: CitySceneProps) {
  const { rise, set } = sunTimes(city, now, offset);
  const phase = phaseOf(hour, rise, set);
  const lit = phase !== "day";
  const Drawing = ART[city];
  return (
    <div aria-hidden="true" data-city={city} data-phase={phase} className={cn("absolute inset-0 overflow-hidden transition-opacity duration-1000 ease-out", active ? "opacity-100" : "opacity-0")}>
      <div key={active ? "on" : "off"} className={cn("absolute inset-0 transform-gpu", active && !still && "animate-drift")}>
        <div className={cn("absolute inset-0 bg-linear-to-b", SKY[phase])} />
        <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full">
          {phase === "night" && <Stars still={still} />}
          <Sky phase={phase} hour={hour} rise={rise} set={set} horizon={HORIZON[city]} />
          <Clouds phase={phase} still={still} />
          {lit && <ellipse cx={800} cy={HORIZON[city]} rx={1000} ry={190} className="fill-scene-window" opacity={phase === "night" ? 0.08 : 0.05} />}
          <Drawing lit={lit} still={still} hour={hour} />
        </svg>
      </div>
    </div>
  );
}

export default CityScene;
