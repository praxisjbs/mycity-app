/**
 * @component PublicPage
 * @group Shell
 * @summary The public site's page on its faint City Green ground: the mark and the theme switch on top; the page on one card (at most 704 px), beside a Deep Green context pane, or as open sections up to 1120 px; a Deep Green footer under a Lagos skyline edge.
 * @use Every page of go.mycityapp.io (careers, a vacancy, apply, assessment, sign, verify); PageMessage is a whole-page outcome inside it (sent, expired, not found). layout open for a page a stranger browses (Careers, a Vacancy), with a SkylineHero at its head; the card for a page a person fills in or reads once, with a `pane` (SkylineHero size pane) carrying its identity where it has one.
 * @avoid The staff app (it has its own shells); a second card inside the card; a page of explanation (a PageMessage says one thing).
 * @phone The card runs edge to edge with no side border; with a pane, the pane is a compact band at the top and the card rises over its foot as a sheet; open, the page's first block (its hero) runs edge to edge and its sections keep their own 16 px margin; the header keeps a 16 px margin; the theme switch and the footer's links are 44 px targets; a `bar` is fixed at the foot and the page keeps room for it.
 * @a11y A banner, a main and a contentinfo landmark; the theme switch is a named button; the pane is inside the main, before the card, so the h1 it carries comes first. The skyline edge is decorative. PageMessage's title is a heading (h2) and its icon is decorative.
 * @status stable
 * @exports PageMessage
 * @example <PublicPage brand={<a href="/jobs"><Brand name="MyCityApp" /></a>} links={<a href="/verify">Verify a Document</a>}>...</PublicPage>
 * @example <PublicPage pane={<SkylineHero size="pane" title="Partnerships Associate" record />}>...</PublicPage>
 * @example <PageMessage icon="ok" tone="ok" title="Application Sent">We read every application.</PageMessage>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatTime } from "../lib/format";
import { useMinute } from "../lib/lagos";
import { useTheme } from "../lib/preferences";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";
import { StickyColumns } from "../layout/StickyColumns";
import { Brand } from "./Brand";

export interface PublicPageProps {
  /** The mark at the top left, usually a link home with Brand; left out when the page draws its own inside the card. */
  brand?: ReactNode;
  /** The page, drawn on the card. */
  children: ReactNode;
  /** The context pane: a SkylineHero of size pane with the page's heading and facts. On desktop (1041 px and wider) it stands at the left and the card at the right, both sticking; narrower, it is a band above the card. */
  pane?: ReactNode;
  /** Anything under the card (a second action, a note from the system). */
  below?: ReactNode;
  /** A phone's action bar, fixed at the foot of the screen (a vacancy's Apply); the page keeps room for it. Pass it inside PhoneOnly. */
  bar?: ReactNode;
  /** The footer's links (Careers, Verify a Document). */
  links?: ReactNode;
  /** The company line at the foot; MyCity App Ltd · Lagos, Nigeria unless set. */
  company?: string;
  /** More at the very foot (the mock's demo links, on a laptop only). */
  foot?: ReactNode;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
  /** `card` (the default): the page on one card, 704 px, or beside its pane. `open`: no card, up to 1120 px, the page lays out its own sections. */
  layout?: "card" | "open";
}

const WIDTH = "mx-auto w-full max-w-176";
const WIDE = "mx-auto w-full max-w-280";
const CARD = "border border-border bg-card p-6 shadow-2 phone:border-x-0 phone:p-4 desk:p-8";

export function PublicPage({ brand, children, pane, below, bar, links, company = "MyCity App Ltd · Lagos, Nigeria", foot, landmarks = true, layout = "card" }: PublicPageProps) {
  const { theme, toggle } = useTheme();
  const Main = landmarks ? "main" : "div";
  const open = layout === "open";
  const split = !open && pane != null;
  const width = open || split ? WIDE : WIDTH;
  return (
    <div className="public-ground flex flex-1 flex-col" data-layout={layout} data-canvas="">
      <header className={cn(WIDE, "flex items-center justify-between px-6 pt-5 pb-3 phone:px-4")}>
        <span className="*:inline-flex *:min-h-tap *:items-center">{brand}</span>
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light Theme" : "Dark Theme"} onClick={toggle} />
      </header>
      <Main className={cn(width, "flex-1 px-6 pb-16 phone:px-0 phone:pb-10")}>
        {split ? (
          <StickyColumns>
            {pane}
            <div className={cn(CARD, "animate-enter rounded-card enter-delay-3 phone:relative phone:-mt-4 phone:rounded-t-sheet phone:rounded-b-none phone:border-b-0")}>{children}</div>
          </StickyColumns>
        ) : open ? (
          children
        ) : (
          <div className={cn(CARD, "animate-enter rounded-card enter-delay-1 phone:rounded-none")}>{children}</div>
        )}
        {below}
        {bar}
      </Main>
      <Footer links={links} company={company} clear={bar != null}>
        {foot}
      </Footer>
    </div>
  );
}

/** A Lagos skyline drawn as one silhouette: towers, the mast and the round-topped tower, the Link Bridge and its pylon. */
const EDGE =
  "M0 64V54h28V64ZM29 64V56h38V64ZM65 64V55h35V64ZM100 64V56h36V64ZM138 64V56h24V64ZM160 64V50h31V64ZM189 64V55h25V64ZM216 64V56h31V64ZM249 64V53h21V64ZM273 64V47h38V64ZM300 64V32h40V64ZM341 64V43h23V64ZM362 64V46h39V64ZM401 64V46h35V64ZM438 64V32h25V64ZM463 64V24h39V64ZM505 64V47h27V64ZM534 64V30h40V64ZM573 64V47h33V64ZM608 64V48h44V64ZM654 64V31h23V64ZM676 64V29h37V64ZM380 64V12h30V64ZM393 12V2h3V12ZM560 64V24Q578 6 596 24V64ZM700 64V44h33V64ZM734 64V40h38V64ZM772 64V47h29V64ZM800 64V52h27V64ZM829 64V38h29V64ZM859 64V40h30V64ZM860 50h740v5H860ZM900 64V50h6V64ZM960 64V50h6V64ZM1020 64V50h6V64ZM1240 64V50h6V64ZM1300 64V50h6V64ZM1360 64V50h6V64ZM1420 64V50h6V64ZM1480 64V50h6V64ZM1540 64V50h6V64ZM1124 64L1128 8h8l4 56ZM1560 64V55h23V64ZM1581 64V50h22V64Z";
const CABLES =
  "M1132 14L1066 50M1132 14L1198 50M1132 20L1032 50M1132 20L1232 50M1132 26L998 50M1132 26L1266 50M1132 32L964 50M1132 32L1300 50M1132 38L930 50M1132 38L1334 50M1132 44L896 50M1132 44L1368 50";

/** The foot of every public page: Deep Green under the skyline's edge, the mark, the links, the company and the time in Lagos. */
function Footer({ links, company, clear, children }: { links?: ReactNode; company: string; clear: boolean; children?: ReactNode }) {
  const now = useMinute();
  return (
    <footer className="mt-auto">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 1600 64" preserveAspectRatio="xMidYMax slice" className="block h-12 w-full fill-deep stroke-deep phone:h-9">
        <path d={EDGE} />
        <path d={CABLES} fill="none" strokeWidth={1.4} />
      </svg>
      <div data-theme="dark" className={cn("on-dark bg-deep text-on-deep-muted", clear && "phone:pb-24")}>
        <div className={cn(WIDE, "grid grid-cols-1 gap-6 px-6 py-8 text-sm md:grid-cols-3 md:items-start phone:gap-4 phone:px-4 phone:pt-5")}>
          <div className="flex flex-col gap-2">
            <Brand name="MyCityApp" tone="on-dark" />
            <p className="text-xs text-on-deep-faint">{company}</p>
          </div>
          {links != null && (
            <nav aria-label="Site" className="flex flex-wrap gap-x-6 gap-y-1 *:inline-flex *:min-h-tap *:items-center *:font-strong *:text-on-deep-soft *:no-underline md:justify-center">
              {links}
            </nav>
          )}
          <LagosClock now={now} />
        </div>
        {children != null && <div className={cn(WIDE, "px-6 pb-6 phone:px-4")}>{children}</div>}
      </div>
    </footer>
  );
}

/** The time in Lagos now, read again each minute. */
function LagosClock({ now }: { now: Date }) {
  const iso = now.toISOString();
  return (
    <p className="flex items-center gap-2 text-xs text-on-deep-faint md:justify-end">
      <Icon name="clock" className="text-primary" />
      <span>Lagos</span>
      <time dateTime={iso} className="text-base font-strong text-on-deep tabular-nums">
        {formatTime(iso)}
      </time>
    </p>
  );
}

/** The tones a PageMessage takes. */
export type PageMessageTone = "neutral" | "ok" | "warn" | "err";

export interface PageMessageProps {
  /** The glyph in the circle; alert unless set. */
  icon?: IconName;
  /** The circle's tone; neutral unless set. */
  tone?: PageMessageTone;
  /** What happened, at most 6 words (Application Sent, Offer Expired). */
  title: ReactNode;
  /** One or two short sentences: what the person can do now. */
  children?: ReactNode;
  /** One or two actions, usually Buttons. */
  action?: ReactNode;
}

const TONE: Record<PageMessageTone, string> = {
  neutral: "bg-accent text-accent-foreground",
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  err: "bg-destructive-soft text-destructive",
};

/** A whole-page outcome on the public site: a bad link, an expired offer, an application sent. Its mark lands once as it opens. */
export function PageMessage({ icon = "alert", tone = "neutral", title, children, action }: PageMessageProps) {
  return (
    <div className="py-6 text-center">
      <span className={cn("mx-auto flex size-14 animate-pop items-center justify-center rounded-full enter-delay-3", TONE[tone])}>
        <Icon name={icon} size="l" />
      </span>
      <h2 data-ui="title" className="mt-3 text-xl font-strong">
        {title}
      </h2>
      {children != null && <div className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">{children}</div>}
      {action != null && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
