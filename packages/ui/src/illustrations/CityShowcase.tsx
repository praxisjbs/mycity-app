/**
 * @component CityShowcase
 * @group Display
 * @summary The sign-in screen's picture: photographs of eight cities at dusk taking turns, each with its clock; on desktop they drift slowly and crossfade, on a phone they hold still behind a frosted panel.
 * @use The staff sign-in screen only: `full` beside the form on desktop, `phone` behind it on a phone.
 * @avoid Any screen behind sign-in, and decoration anywhere else (use Illustration).
 * @phone variant="phone": the photograph fills the top of the screen, still, with the brand, a glass clock and the city; the form sits in a frosted dark panel below it. The city changes each interval with a plain crossfade, nothing moves.
 * @a11y The photographs and drawings are decorative (empty alt, aria-hidden). The cities are a group of buttons, each naming the city and its time, the shown one marked aria-current. Turning pauses while the pointer or focus is on them, and stops under reduced motion (the drawings hold still too). The phone's panel takes the dark theme's colours, so its text keeps AA over any photograph.
 * @status beta
 * @example <CityShowcase>{brandAndHeadline}</CityShowcase>
 * @example <CityShowcase variant="phone" aside={<SignInForm />}><Brand tone="on-dark" /></CityShowcase>
 * @example <CityShowcase aside={<SignInCard />}>{brandAndHeadline}</CityShowcase>
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { zoneClock } from "../lib/format";
import { useMediaQuery } from "../lib/media";
import type { DrawnCity } from "./CityShowcase.draw";
import lagosLarge from "./photos/lagos-1280.webp";
import lagosSmall from "./photos/lagos-640.webp";
import lagosPhone from "./photos/lagos-phone.webp";
import londonLarge from "./photos/london-1280.webp";
import londonSmall from "./photos/london-640.webp";
import londonPhone from "./photos/london-phone.webp";
import accraLarge from "./photos/accra-1280.webp";
import accraSmall from "./photos/accra-640.webp";
import accraPhone from "./photos/accra-phone.webp";
import nairobiLarge from "./photos/nairobi-1280.webp";
import nairobiSmall from "./photos/nairobi-640.webp";
import nairobiPhone from "./photos/nairobi-phone.webp";
import johannesburgLarge from "./photos/johannesburg-1280.webp";
import johannesburgSmall from "./photos/johannesburg-640.webp";
import johannesburgPhone from "./photos/johannesburg-phone.webp";
import rabatLarge from "./photos/rabat-1280.webp";
import rabatSmall from "./photos/rabat-640.webp";
import rabatPhone from "./photos/rabat-phone.webp";
import abidjanLarge from "./photos/abidjan-1280.webp";
import abidjanSmall from "./photos/abidjan-640.webp";
import abidjanPhone from "./photos/abidjan-phone.webp";
import doualaLarge from "./photos/douala-1280.webp";
import doualaSmall from "./photos/douala-640.webp";
import doualaPhone from "./photos/douala-phone.webp";

/** Every city shown: the four with a drawing, and four with a photograph only. */
export type CityKey = DrawnCity | "johannesburg" | "rabat" | "abidjan" | "douala";

const CityScene = lazy(() => import("./CityShowcase.draw"));

/** The cities, with the name, country and time zone each shows under. */
export const SHOWCASE_CITIES: Record<CityKey, { name: string; country: string; timeZone: string }> = {
  lagos: { name: "Lagos", country: "Nigeria", timeZone: "Africa/Lagos" },
  london: {
    name: "London",
    country: "United Kingdom",
    timeZone: "Europe/London",
  },
  accra: { name: "Accra", country: "Ghana", timeZone: "Africa/Accra" },
  nairobi: { name: "Nairobi", country: "Kenya", timeZone: "Africa/Nairobi" },
  johannesburg: {
    name: "Johannesburg",
    country: "South Africa",
    timeZone: "Africa/Johannesburg",
  },
  rabat: { name: "Rabat", country: "Morocco", timeZone: "Africa/Casablanca" },
  abidjan: {
    name: "Abidjan",
    country: "Côte d'Ivoire",
    timeZone: "Africa/Abidjan",
  },
  douala: { name: "Douala", country: "Cameroon", timeZone: "Africa/Douala" },
};

const ALL: CityKey[] = ["lagos", "london", "accra", "nairobi", "johannesburg", "rabat", "abidjan", "douala"];
const DRAWN = new Set<CityKey>(["lagos", "london", "accra", "nairobi"]);
const isDrawn = (c: CityKey): c is DrawnCity => DRAWN.has(c);

/**
 * Each city's photograph at dusk: 1280 and 640 wide for desktop, a 2:3 portrait
 * crop on its landmark for the phone, and the path its slow drift takes.
 */
const PHOTOS: Record<CityKey, { large: string; small: string; phone: string; drift: string }> = {
  lagos: { large: lagosLarge, small: lagosSmall, phone: lagosPhone, drift: "animate-ken-1" },
  london: { large: londonLarge, small: londonSmall, phone: londonPhone, drift: "animate-ken-2" },
  accra: { large: accraLarge, small: accraSmall, phone: accraPhone, drift: "animate-ken-3" },
  nairobi: { large: nairobiLarge, small: nairobiSmall, phone: nairobiPhone, drift: "animate-ken-4" },
  johannesburg: { large: johannesburgLarge, small: johannesburgSmall, phone: johannesburgPhone, drift: "animate-ken-1" },
  rabat: { large: rabatLarge, small: rabatSmall, phone: rabatPhone, drift: "animate-ken-2" },
  abidjan: { large: abidjanLarge, small: abidjanSmall, phone: abidjanPhone, drift: "animate-ken-3" },
  douala: { large: doualaLarge, small: doualaSmall, phone: doualaPhone, drift: "animate-ken-4" },
};

export interface CityShowcaseProps {
  /** `full` fills its parent, with the clock and the city buttons at the foot; `phone` fills a phone's screen, the picture at the top. */
  variant?: "full" | "phone";
  /** Which cities, in order. All eight by default. */
  cities?: CityKey[];
  /** How long each city shows, in milliseconds. */
  interval?: number;
  /** The first city shown. */
  start?: CityKey;
  /** What sits at the top over the picture: the brand, and on `full` a headline. */
  children?: ReactNode;
  /** The sign-in form. `full`: stands at the right over the picture, centred, as given; the clock and the cities keep clear of it. `phone`: set in the frosted panel under the city. */
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
  const phone = variant === "phone";
  const still = reduced || phone;
  /** Photographs that have arrived (their drawing is no longer needed) and those that cannot. */
  const [loaded, setLoaded] = useState<Partial<Record<CityKey, true>>>({});
  const [failed, setFailed] = useState<Partial<Record<CityKey, true>>>({});
  /** How many times each city has come round: a new turn restarts its drift from the beginning. */
  const [turns, setTurns] = useState<Partial<Record<CityKey, number>>>({});
  const section = useRef<HTMLElement>(null);

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
  const next = order[(index + 1) % order.length]!;
  const city = SHOWCASE_CITIES[current];
  const clock = clocks[current];

  useEffect(() => setTurns((t) => ({ ...t, [current]: (t[current] ?? 0) + 1 })), [current]);

  /** A city's picture is fetched when it is shown or next, and kept once it has arrived: eight at once would cost a phone its data. */
  const wanted = (c: CityKey) => c === current || c === next || !!loaded[c];

  /** The parallax: where the pointer is over the picture, from -0.5 to 0.5 each way. */
  const follow = (e: PointerEvent<HTMLElement>) => {
    const el = section.current;
    if (!el || still) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  };
  const settle = () => {
    section.current?.style.setProperty("--px", "0");
    section.current?.style.setProperty("--py", "0");
  };

  const pictures = (
    <>
      <Suspense fallback={null}>
        {order.map((c, i) =>
          isDrawn(c) && !loaded[c] && wanted(c) ? <CityScene key={c} city={c} hour={clocks[c].hour} offset={clocks[c].offset} now={now} active={i === index} still={still} /> : null,
        )}
      </Suspense>
      {order.map((c, i) =>
        failed[c] || !wanted(c) ? null : (
          <div
            key={`photo-${c}`}
            aria-hidden="true"
            data-photo={c}
            className={cn(
              "absolute inset-0 overflow-hidden ease-out",
              phone ? "transition-opacity duration-1000" : "transition-all duration-1000",
              i === index && loaded[c] ? "opacity-100 blur-none" : cn("opacity-0", !phone && "blur-sm"),
            )}
          >
            <div className={cn("absolute inset-0 transform-gpu", !still && "city-parallax")}>
              <img
                key={still ? c : `${c}-${turns[c] ?? 0}`}
                src={phone ? PHOTOS[c].phone : PHOTOS[c].large}
                srcSet={phone ? undefined : `${PHOTOS[c].small} 640w, ${PHOTOS[c].large} 1280w`}
                sizes={phone ? undefined : "100vw"}
                alt=""
                decoding="async"
                onLoad={() => setLoaded((l) => (l[c] ? l : { ...l, [c]: true }))}
                onError={() => setFailed((f) => ({ ...f, [c]: true }))}
                className={cn("absolute inset-0 size-full object-cover transform-gpu", !still && PHOTOS[c].drift)}
              />
              {!still && <div className="city-glow pointer-events-none absolute inset-0 animate-glow" />}
            </div>
          </div>
        ),
      )}
    </>
  );

  if (phone) {
    return (
      <section aria-label="MyCity cities" data-ui="city-showcase" className={cn("relative isolate overflow-hidden bg-deep text-on-deep", className)}>
        <div className="absolute inset-x-0 top-0 h-2/3">
          {pictures}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-t from-deep via-deep/60 via-35% to-transparent to-70%" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-deep/60 to-transparent" />
        </div>
        <div className="relative flex min-h-full flex-col px-4 pt-safe pb-safe-5">
          <div className="flex items-center justify-between gap-3 pt-4">
            {children}
            <time className="flex flex-none items-center gap-2 rounded-full border border-on-deep/15 bg-deep/35 px-3 py-1.5 text-sm font-semibold tabular-nums shadow-2 backdrop-blur-md">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              {clock.time}
            </time>
          </div>
          <div className="min-h-36 flex-1" />
          <p className="text-2xs font-semibold tracking-caps text-primary uppercase">{city.country}</p>
          <p className="text-4xl font-strong tracking-tight">{city.name}</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-on-deep-soft">{clock.day}</span>
            <span aria-hidden="true" className="flex items-center gap-1">
              {order.map((c, i) => (
                <span key={c} className={cn("h-1 rounded-full", i === index ? "w-4 bg-primary" : "w-1 bg-on-deep-faint")} />
              ))}
            </span>
          </div>
          {aside && (
            <div data-theme="dark" className="mt-5 rounded-sheet border border-glass-border bg-glass p-5 text-card-foreground shadow-3 backdrop-blur-xl">
              {aside}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={section}
      aria-label="MyCity cities"
      data-ui="city-showcase"
      onPointerMove={follow}
      onPointerLeave={settle}
      className={cn("relative isolate overflow-hidden bg-deep text-on-deep", className)}
    >
      {pictures}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-t from-deep/95 via-deep/40 via-30% to-transparent to-65%" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-deep/50 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-deep/55 to-transparent" />

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
              className="mt-8 grid max-w-2xl grid-cols-4 gap-x-4 gap-y-2"
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
                  <span className={cn("mt-2 block truncate text-sm font-semibold transition-colors duration-(--dur)", i === index ? "text-on-deep" : "text-on-deep-faint group-hover:text-on-deep-soft")}>
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
    </section>
  );
}
