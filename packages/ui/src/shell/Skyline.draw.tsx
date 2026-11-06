import { useId } from "react";

export interface SkylineProps {
  /** No twinkle in the windows (a still picture, the gallery). */
  still?: boolean;
}

const FAR: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 250, 60, 150], [55, 190, 70, 210], [120, 230, 50, 170], [165, 140, 80, 260], [240, 210, 60, 190], [295, 100, 90, 300],
  [380, 180, 55, 220], [430, 120, 70, 280], [495, 200, 60, 200], [550, 160, 85, 240], [630, 220, 60, 180], [1180, 260, 70, 140],
  [1245, 220, 60, 180], [1300, 270, 90, 130], [1385, 230, 55, 170],
];
const NEAR: ReadonlyArray<readonly [number, number, number, number]> = [
  [20, 280, 90, 120], [100, 210, 70, 190], [165, 140, 110, 260], [270, 250, 60, 150], [325, 70, 100, 330], [420, 170, 80, 230],
  [495, 110, 120, 290], [610, 230, 70, 170], [675, 280, 95, 120], [1150, 310, 80, 90], [1225, 280, 110, 120], [1330, 300, 70, 100],
  [1395, 260, 60, 140],
];
const LIT: ReadonlyArray<readonly [number, number, number, number]> = [
  [20, 290, 90, 100], [165, 150, 110, 240], [325, 80, 100, 310], [495, 120, 120, 270], [675, 290, 95, 100], [1225, 290, 110, 100],
  [1395, 270, 60, 120],
];
/** The Link Bridge's cables, from the pylon's head out to the deck on each side. */
const CABLES: ReadonlyArray<readonly [number, number, number]> = [
  [168, 760, 384], [180, 820, 384], [192, 880, 384], [204, 940, 384], [216, 995, 384],
  [168, 1330, 384], [180, 1270, 384], [192, 1210, 384], [204, 1150, 384], [216, 1095, 384],
];
const ROAD: ReadonlyArray<readonly [number, number, number]> = [
  [120, 220, 430], [380, 520, 452], [640, 700, 438], [880, 1010, 462], [1120, 1260, 444], [260, 420, 492], [760, 900, 506], [1200, 1360, 512],
];
const PALMS: ReadonlyArray<readonly [string, number]> = [
  ["M150 560 Q160 440 186 330", 14], ["M186 330 q-70 -40 -140 6", 12], ["M186 330 q-40 -70 -110 -60", 12], ["M186 330 q20 -80 80 -96", 12],
  ["M186 330 q80 -30 140 14", 12], ["M186 330 q60 20 90 80", 12], ["M1340 560 Q1330 430 1296 300", 14], ["M1296 300 q-80 -20 -130 30", 12],
  ["M1296 300 q-40 -70 -100 -70", 12], ["M1296 300 q30 -80 100 -80", 12], ["M1296 300 q80 -10 130 40", 12],
];

/**
 * The public site's Lagos at dusk: the towers in two depths with their windows lit, the sun low behind
 * them, the Link Bridge and its pylon, the lagoon road, and a palm at each side. One drawing behind every
 * hero and the sign-in aside, in tokens (public.css .ps-sky-*), its windows slowly brightening and dimming.
 */
export function Skyline({ still }: SkylineProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" data-still={still || undefined}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="ps-sky-top" />
          <stop offset=".65" className="ps-sky-mid" />
          <stop offset="1" className="ps-sky-low" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx=".5" cy=".5" r=".5">
          <stop offset="0" className="ps-sky-sun" stopOpacity=".95" />
          <stop offset=".35" className="ps-sky-sun" stopOpacity=".4" />
          <stop offset="1" className="ps-sky-sun" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-win`} width="18" height="22" patternUnits="userSpaceOnUse">
          <rect x="4" y="5" width="5" height="7" className="ps-sky-gold" />
          <rect x="12" y="13" width="4" height="5" className="ps-sky-cool" />
        </pattern>
      </defs>
      <rect width="1440" height="560" fill={`url(#${id}-sky)`} />
      <circle cx="900" cy="300" r="200" fill={`url(#${id}-sun)`} />
      <g className="ps-sky-far">
        {FAR.map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>
      <g className="ps-sky-near">
        {NEAR.map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>
      <g className="ps-sky-win" fill={`url(#${id}-win)`} opacity=".6">
        {LIT.map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>
      <g className="ps-sky-cable" strokeWidth="2" opacity=".8">
        {CABLES.map(([y1, x2, y2]) => (
          <line key={`${y1}-${x2}`} x1="1043" y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <rect x="1036" y="150" width="14" height="250" className="ps-sky-near" />
      <rect x="700" y="384" width="740" height="9" className="ps-sky-near" />
      <rect x="0" y="400" width="1440" height="160" className="ps-sky-ground" />
      <g className="ps-sky-road" strokeWidth="2" strokeLinecap="round" opacity=".55">
        {ROAD.map(([x1, x2, y]) => (
          <line key={`${x1}-${y}`} x1={x1} y1={y} x2={x2} y2={y} />
        ))}
      </g>
      <g className="ps-sky-palm" fill="none" strokeLinecap="round">
        {PALMS.map(([d, w]) => (
          <path key={d} d={d} strokeWidth={w} />
        ))}
      </g>
    </svg>
  );
}
