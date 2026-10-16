/**
 * @component CityShowcase
 * @group Display
 * @summary The sign-in screen's moving picture: Lagos, London, Accra and Nairobi drawn at their own local hour, taking turns, each with its clock.
 * @use The staff sign-in screen only: `full` beside the form on desktop, `band` above it on a phone.
 * @avoid Any screen behind sign-in, and decoration anywhere else (use Illustration).
 * @phone variant="band": a short band with the city, its country and its time; the drawing holds still and the city changes each interval.
 * @a11y The drawings are decorative (aria-hidden). The cities are a group of buttons, each naming the city and its time, the shown one marked aria-current. Turning pauses while the pointer or focus is on them, and stops under reduced motion (the drawings hold still too).
 * @status beta
 * @example <CityShowcase>{brandAndHeadline}</CityShowcase>
 * @example <CityShowcase variant="band"><Brand tone="on-dark" /></CityShowcase>
 * @example <CityShowcase aside={<SignInCard />}>{brandAndHeadline}</CityShowcase>
 */
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { zoneClock } from "../lib/format";
import { useMediaQuery } from "../lib/media";
import type { CityKey } from "./CityShowcase.draw";

export type { CityKey } from "./CityShowcase.draw";

const CityScene = lazy(() => import("./CityShowcase.draw"));

/** The cities drawn, with the name, country and time zone each shows under. */
export const SHOWCASE_CITIES: Record<CityKey, { name: string; country: string; timeZone: string }> = {
  lagos: { name: "Lagos", country: "Nigeria", timeZone: "Africa/Lagos" },
  london: {
    name: "London",
    country: "United Kingdom",
    timeZone: "Europe/London",
  },
  accra: { name: "Accra", country: "Ghana", timeZone: "Africa/Accra" },
  nairobi: { name: "Nairobi", country: "Kenya", timeZone: "Africa/Nairobi" },
};

const ALL: CityKey[] = ["lagos", "london", "accra", "nairobi"];

export interface CityShowcaseProps {
  /** `full` fills its parent, with the clock and the city buttons at the foot; `band` is the phone's short strip. */
  variant?: "full" | "band";
  /** Which cities, in order. All four by default. */
  cities?: CityKey[];
  /** How long each city shows, in milliseconds. */
  interval?: number;
  /** The first city shown. */
  start?: CityKey;
  /** What sits at the top over the picture: the brand, and on `full` a headline. */
  children?: ReactNode;
  /** `full` only: what stands at the right over the picture, centred (the sign-in card). The clock and the cities keep clear of it. */
  aside?: ReactNode;
  /** Layout classes only (height, the grid cell); the look is the component's own. */
  className?: string;
}

function clockOf(now: Date, timeZone: string) {
  const c = zoneClock(now, timeZone);
  let offset = c.hour - (now.getUTCHours() + now.getUTCMinutes() / 60);
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return { ...c, offset: Math.round(offset * 4) / 4 };
}

export function CityShowcase({ variant = "full", cities = ALL, interval = 9000, start, children, aside, className }: CityShowcaseProps) {
  const order = cities.length ? cities : ALL;
  const [index, setIndex] = useState(() => Math.max(0, start ? order.indexOf(start) : 0));
  const [now, setNow] = useState(() => new Date());
  const [hold, setHold] = useState(false);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const still = reduced || variant === "band";

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (reduced || hold) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % order.length), interval);
    return () => clearTimeout(t);
  }, [index, reduced, hold, interval, order.length]);

  const clocks = useMemo(() => Object.fromEntries(order.map((c) => [c, clockOf(now, SHOWCASE_CITIES[c].timeZone)])) as Record<CityKey, ReturnType<typeof clockOf>>, [now, order]);
  const current = order[index % order.length]!;
  const city = SHOWCASE_CITIES[current];
  const clock = clocks[current];

  return (
    <section aria-label="MyCity cities" data-ui="city-showcase" className={cn("relative isolate overflow-hidden bg-deep text-on-deep", className)}>
      <Suspense fallback={null}>
        {order.map((c, i) => (
          <CityScene key={c} city={c} hour={clocks[c].hour} offset={clocks[c].offset} now={now} active={i === index} still={still} />
        ))}
      </Suspense>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-t from-deep/95 via-deep/40 via-30% to-transparent to-65%" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-deep/50 to-transparent" />
      {variant === "full" && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-deep/55 to-transparent" />}

      {variant === "band" ? (
        <div className="relative flex h-full flex-col px-4 pt-4 pb-5">
          {children}
          <p key={`k${current}`} className="mt-auto animate-rise text-2xs font-semibold tracking-caps text-primary uppercase">
            {city.country}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <span key={`n${current}`} className="animate-rise text-3xl font-strong">
              {city.name}
            </span>
            <time className="text-3xl font-light tabular-nums text-on-deep-soft">{clock.time}</time>
          </div>
          <div aria-hidden="true" className="mt-3 flex gap-1.5">
            {order.map((c, i) => (
              <span key={c} className={cn("h-1 rounded-full transition-all duration-(--dur) ease-out", i === index ? "w-6 bg-primary" : "w-1.5 bg-on-deep-faint")} />
            ))}
          </div>
        </div>
      ) : (
        <div className="relative flex h-full gap-10 p-12 xl:p-14">
          <div className="flex min-w-0 flex-1 flex-col">
            {children}
            <div className="mt-auto">
              <p key={`k${current}`} className="animate-rise text-xs font-semibold tracking-caps text-primary uppercase">
                {city.country}
              </p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5">
                <h2 key={`n${current}`} className="animate-rise text-hero font-strong tracking-tight">
                  {city.name}
                </h2>
                <time className="text-hero font-light tabular-nums text-on-deep-soft">{clock.time}</time>
              </div>
              <p className="mt-2 text-md text-on-deep-muted">{clock.day}</p>
              <div
                role="group"
                aria-label="Cities"
                className="mt-9 grid max-w-2xl grid-cols-4 gap-4"
                onPointerEnter={() => setHold(true)}
                onPointerLeave={() => setHold(false)}
                onFocus={() => setHold(true)}
                onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHold(false)}
              >
                {order.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    aria-current={i === index ? "true" : undefined}
                    onClick={() => setIndex(i)}
                    className="group min-h-tap rounded-ctl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="block h-0.5 overflow-hidden rounded-full bg-on-deep/20">
                      {i === index && (
                        <span
                          key={`${index}-${hold}`}
                          className={cn("block h-full origin-left bg-primary", !reduced && !hold && "animate-fill-x")}
                          style={{ "--fill-time": `${interval}ms` } as CSSProperties}
                        />
                      )}
                    </span>
                    <span className={cn("mt-2.5 block text-sm font-semibold transition-colors duration-(--dur)", i === index ? "text-on-deep" : "text-on-deep-faint group-hover:text-on-deep-soft")}>
                      {SHOWCASE_CITIES[c].name}
                    </span>
                    <span className="block text-xs tabular-nums text-on-deep-faint">{clocks[c].time}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {aside && <div className="flex flex-none items-center">{aside}</div>}
        </div>
      )}
    </section>
  );
}
