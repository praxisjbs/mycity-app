/**
 * @component YearsMedal
 * @group Display
 * @summary The years a person has been at MyCity, large, inside a gold laurel.
 * @use The work anniversary card in Staff Community, on its City Green surface (community.md §3 step 3).
 * @avoid Any other figure (a count or a total is a KpiTile); a light surface, where the gold leaves do not carry.
 * @phone Shrinks from 140 px to 96 px at 760 px and below; the laurel keeps its shape.
 * @a11y One image named "3 years at MyCity" ("Another year at MyCity" without the years); the leaves and figures inside are not read out one by one.
 * @status beta
 * @example <YearsMedal years={3} />
 * @example <YearsMedal years={null} />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface YearsMedalProps {
  /** Whole years at MyCity; null draws a star in the laurel, for a start date nobody knows. */
  years: number | null;
  /** Layout classes only (its place in a grid); the size is the component's own. */
  className?: string;
}

/* The laurel, worked out once: leaves in pairs along two arcs that meet under the figure. */
const CENTRE = 70;
const RADIUS = 52;
const LEAF = "M0 0Q6.8 -4.8 13.5 0Q6.8 4.8 0 0Z";
const fix = (n: number) => n.toFixed(1);
const at = (deg: number) => [CENTRE + RADIUS * Math.cos((deg * Math.PI) / 180), CENTRE + RADIUS * Math.sin((deg * Math.PI) / 180)] as const;

const BRANCHES = ([1, -1] as const).map((dir) => {
  const start = dir > 0 ? 114 : 66;
  const end = dir > 0 ? 246 : -66;
  const [sx, sy] = at(start);
  const [ex, ey] = at(end);
  const leaves: Array<{ x: number; y: number; turn: number; inner: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const a = start + dir * i * 19;
    const forward = a + dir * 90;
    const [x, y] = at(a);
    leaves.push({ x, y, turn: forward - dir * 40, inner: false });
    const [ix, iy] = at(a + dir * 9);
    leaves.push({ x: ix, y: iy, turn: forward + dir * 40, inner: true });
  }
  leaves.push({ x: ex, y: ey, turn: end + dir * 90, inner: false });
  return { stem: `M${fix(sx)} ${fix(sy)}A${RADIUS} ${RADIUS} 0 0 ${dir > 0 ? 1 : 0} ${fix(ex)} ${fix(ey)}`, leaves };
});

export function YearsMedal({ years, className }: YearsMedalProps) {
  const unit = years === 1 ? "year" : "years";
  return (
    <span role="img" aria-label={years ? `${years} ${unit} at MyCity` : "Another year at MyCity"} className={cn("relative grid size-35 flex-none place-items-center text-primary phone:size-24", className)}>
      <svg viewBox="0 0 140 140" aria-hidden="true" className="absolute inset-0 size-full fill-current">
        {BRANCHES.map((b, i) => (
          <g key={i}>
            <path d={b.stem} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
            {b.leaves.map((l, j) => (
              <path key={j} d={LEAF} transform={`translate(${fix(l.x)} ${fix(l.y)}) rotate(${fix(l.turn)})`} className={l.inner ? "opacity-80" : undefined} />
            ))}
          </g>
        ))}
      </svg>
      <span aria-hidden="true" className="relative flex flex-col items-center leading-none">
        {years ? (
          <>
            <b className="text-hero font-semibold tracking-tight tabular-nums phone:text-4xl">{years}</b>
            <span className="mt-1 text-sm font-medium text-on-deep-soft phone:mt-0.5 phone:text-xs">{unit}</span>
          </>
        ) : (
          <Icon name="star" size="l" className="size-12 phone:size-8" />
        )}
      </span>
    </span>
  );
}
