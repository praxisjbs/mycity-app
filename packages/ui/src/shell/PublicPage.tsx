/**
 * @component PublicPage
 * @group Shell
 * @summary The public site's frame on its faint City Green ground: one glass header (the mark, the nav underlined in yellow, the theme switch, a menu below 1181 px), the page in one of its layouts, and a Deep Green footer under a Lagos skyline edge with the site's columns, the time in Lagos and Back to Top. layout split is the sign-in layout: a sticky aside of bands (who it is for; the small h1 over a large display line, a paragraph and the steps or the clock; the credit) over a faint skyline, beside the page's card.
 * @use Every page of go.mycityapp.io. `full` (the default) for a page that lays out its own blocks edge to edge (the index's SkylineHero size index, a vacancy's SkylineHero size role, the careers list's PageIntro). `split` for the pages a person is sent to and works through (Apply, Assessment, Sign Offer, Verify a Document, and a page opened without its link): pass `name` and `line` (the identity band), `title` (the h1, at most 3 words, drawn small and spaced: Apply, Assessment, Offer of Employment, Verify a Document), `text` (the display line in the band's large type, one sentence of at most 20 words), `paragraph` (a short line under it), `steps` or `aside` (the countdown, a reference's form), and the card (a Panel) as children; it leaves the site footer off. PageMessage is a whole-page outcome inside the Panel (sent, signed, expired, not found), with the reference to quote.
 * @avoid The staff app (it has its own shells); a second header or bar under this one; a logo in the split aside (the header carries the brand); a page of explanation (a PageMessage says one thing); a sentence as the split title (it is `text`, the display line).
 * @phone The header is 60 px with the mark alone (no sub line), the theme switch and the menu, which drops the nav's links down as 52 px rows; the footer's columns stack, each link a 44 px target; a `bar` is drawn fixed at the foot, frosted, only on a phone, and the page keeps room for it. split: from 1040 px down the aside stacks above the card and stops sticking, and its skyline, its steps and its credit are left off, so the card is close to the top.
 * @a11y A banner, a main and a contentinfo landmark; the nav is named Main and the current page carries aria-current; the menu button says whether it is expanded and Esc closes it; the theme switch and Back to Top are named buttons; the footer's columns sit in a nav named Site, each under a heading. split: the aside is a complementary landmark named by its h1 and comes before the card; the steps are a list named Steps with the one in hand marked. The skyline edge and the aside's skyline are decorative, and nothing rises under reduced motion. PageMessage's title is a heading (h2) and its icon is decorative.
 * @status stable
 * @exports PageMessage
 * @example <PublicPage layout="full" navigate={navigate} nav={[{ label: "Careers", href: "/jobs", current: true }, { label: "Verify Document", href: "/verify" }]}>...</PublicPage>
 * @example <PublicPage layout="split" nav={nav} navigate={navigate} name="Head, Sales & Revenue" line="Marketing & Sales, Lekki Phase 1, Lagos" title="Apply" text="Your application, in three steps." paragraph="This link works until 08/11/2026." steps={{ items: ["About You", "CV and Questions", "Why This Role"], at: 0 }}>{card}</PublicPage>
 * @example <PublicPage layout="split" nav={nav} name="Document Check" line="Offer letters, certificates and agreements" title="Verify a Document" text="Check any document we issued." textSize="l" paragraph="Enter the reference printed on the document." aside={referenceForm}>{result}</PublicPage>
 * @example <PageMessage icon="ok" tone="ok" title="Application Sent" reference={{ label: "Your Reference", value: "APP-0042" }} action={seeRoles}>We emailed a copy to you.</PageMessage>
 */
import { useCallback, useEffect, useId, useState, type ReactNode, type Ref } from "react";
import { cn } from "../lib/cn";
import { lagosClock, lagosYear, useMinute } from "../lib/lagos";
import { useTheme } from "../lib/preferences";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";
import { StickyTop } from "../layout/sticky";
import { useMediaQuery } from "../lib/media";
import { StepBar } from "../form/StepBar";
import { Brand } from "./Brand";
import { Skyline } from "./Skyline.draw";
import { SiteNavigate, useSiteLink } from "./site-link";

/** One link in the header's nav and its menu. */
export interface PublicNavItem {
  label: string;
  href: string;
  current?: boolean;
}

/** One column of the footer: its heading and its links. */
export interface PublicFooterColumn {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}

/** The footer's columns as the approved design has them. */
export const PUBLIC_FOOTER_COLUMNS: ReadonlyArray<PublicFooterColumn> = [
  {
    title: "Careers",
    links: [
      { label: "Open Roles", href: "/jobs" },
      { label: "How We Hire", href: "/#hire" },
      { label: "Recommend Someone", href: "/#refer" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "What We Build", href: "/#build" },
      { label: "Visit MyCityApp", href: "https://mycityapp.io" },
    ],
  },
  {
    title: "Documents",
    links: [
      { label: "Verify a Document", href: "/verify" },
      { label: "Offer Letters", href: "/verify" },
      { label: "Certificates", href: "/verify" },
    ],
  },
];

export interface PublicPageProps {
  /** The page; in split, the card at the right. */
  children: ReactNode;
  /** The header's links, left to right; the one for this page has `current`. Below 1181 px they move into the menu. */
  nav?: ReadonlyArray<PublicNavItem>;
  /** The site's router: a plain click on one of the site's own links (the mark, the nav, the footer, a hero's All Roles) goes through it instead of loading the page again. A path with a #part ("/#hire") then scrolls to it. */
  navigate?: (href: string) => void;
  /** Where the mark leads; "/" unless set. */
  home?: string;
  /** The small line under the name in the header's mark (Careers); none unless set. */
  brandSub?: string;
  /** `full` (the default): the page lays out its own blocks edge to edge. `split`: the sign-in layout, the aside beside the card (children). */
  layout?: "full" | "split";
  /** split: who or what the page is for, in bold at the top of the aside (the role, the offer, Document Check). No logo: the header carries the brand. */
  name?: ReactNode;
  /** split: one muted line under the name (the team and the place, the offer's reference). */
  line?: ReactNode;
  /** split: the page's h1, Title Case, at most 3 words (Apply, Assessment, Offer of Employment, Verify a Document), drawn small and spaced over the display line. */
  title?: string;
  /** split: the heading, for a page that moves focus to it; it takes focus without a ring. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** split: the display line under the title, in the band's large type: one sentence of at most 20 words (Your application, in three steps.). */
  text?: ReactNode;
  /** split: `m` (the default) for a page a person works through; `l`, larger and heavier, for a page that is itself the tool (Verify a Document.). */
  textSize?: "m" | "l";
  /** split: a short paragraph under the display line (when the link ends, who it is for), each sentence at most 20 words. */
  paragraph?: ReactNode;
  /** split: the steps down the aside, numbered, the one in hand in yellow, `complete` once all are done (left off from 1040 px down). */
  steps?: { items: readonly string[]; at: number; complete?: boolean };
  /** split: what else the main band holds, under the text and the steps: the clock and the question map, a reference's form. */
  aside?: ReactNode;
  /** Anything under the card (a second action, a note from the system). */
  below?: ReactNode;
  /** A phone's action bar: what it holds (a line and the action, a vacancy's Apply), drawn fixed and frosted at the foot of a phone's screen only; the page keeps room for it. */
  bar?: ReactNode;
  /** false leaves the footer off. Default true, and false in split (the sign-in pages carry no site footer). */
  footer?: boolean;
  /** The footer's columns; the approved design's Careers, Company and Documents unless set (PUBLIC_FOOTER_COLUMNS). */
  columns?: ReadonlyArray<PublicFooterColumn>;
  /** The line under the footer's mark. */
  tagline?: string;
  /** The company at the foot, after the © and the year; MyCity App Ltd. Lagos, Nigeria. unless set. */
  company?: string;
  /** More at the very foot (the mock's demo links, on a laptop only). */
  foot?: ReactNode;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
}

/** The header's height on desktop, where columns stick under it (public.css .ps-header-in). */
const HEADER = 64;

export function PublicPage({
  children,
  nav = [],
  navigate,
  home = "/",
  brandSub,
  layout = "full",
  name,
  line,
  title,
  titleRef,
  text,
  textSize,
  paragraph,
  steps,
  aside,
  below,
  bar,
  footer = layout !== "split",
  columns = PUBLIC_FOOTER_COLUMNS,
  tagline = "The city and lifestyle platform for every Nigerian city.",
  company = "MyCity App Ltd. Lagos, Nigeria.",
  foot,
  landmarks = true,
}: PublicPageProps) {
  const Main = landmarks ? "main" : "div";
  return (
    <SiteNavigate.Provider value={navigate}>
      <StickyTop.Provider value={HEADER}>
        <div className="public-ground ps-site flex flex-1 flex-col" data-layout={layout} data-canvas="">
          <Header nav={nav} home={home} brandSub={brandSub} />
          <Main className="flex-1">
            {layout === "split" ? (
              <Split name={name} line={line} title={title ?? ""} titleRef={titleRef} text={text} textSize={textSize} paragraph={paragraph} steps={steps} aside={aside}>
                {children}
              </Split>
            ) : (
              children
            )}
            {below}
            {bar != null && <div className="ps-bar">{bar}</div>}
          </Main>
          {footer && (
            <Footer columns={columns} tagline={tagline} company={company} home={home} clear={bar != null}>
              {foot}
            </Footer>
          )}
          {!footer && foot != null && <div className="public-wrap pb-6">{foot}</div>}
        </div>
      </StickyTop.Provider>
    </SiteNavigate.Provider>
  );
}

/** The sign-in layout: the aside's bands over its skyline, sticking under the header, beside the card, which waits centred. */
function Split({
  name,
  line,
  title,
  titleRef,
  text,
  textSize = "m",
  paragraph,
  steps,
  aside,
  children,
}: Pick<PublicPageProps, "name" | "line" | "titleRef" | "text" | "textSize" | "paragraph" | "steps" | "aside"> & { title: string; children: ReactNode }) {
  const now = useMinute();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const titleId = useId();
  return (
    <div className="ps-auth">
      <aside className="ps-auth-aside" aria-labelledby={titleId}>
        <div aria-hidden="true" className="ps-auth-art">
          <Skyline still={reduced} />
        </div>
        <div className="ps-auth-inner">
          {(name != null || line != null) && (
            <div className="ps-auth-band ps-rise ps-rise-2">
              <span className="ps-auth-id" data-copy="content">
                {name != null && <b>{name}</b>}
                {line != null && <span>{line}</span>}
              </span>
            </div>
          )}
          <div className="ps-auth-band ps-auth-main ps-rise ps-rise-3">
            <div className="ps-auth-body">
              <h1 id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined} data-ui="page-title" className="ps-eyebrow ps-auth-title outline-none">
                {title}
              </h1>
              {text != null && <p className={cn("ps-auth-h", textSize === "l" && "ps-auth-h-l")}>{text}</p>}
              {paragraph != null && <p className="ps-auth-text">{paragraph}</p>}
              {steps != null && steps.items.length > 0 && (
                <div className="ps-auth-steps">
                  <StepBar vertical steps={steps.items} at={steps.at} complete={steps.complete} />
                </div>
              )}
              {aside != null && <div className="ps-auth-extra">{aside}</div>}
            </div>
          </div>
          <div className="ps-auth-band ps-auth-foot">
            <p className="ps-auth-credit">
              <span>© {lagosYear(now)} MyCity App Ltd</span>
              <span>
                Engineered by <b>JBS Praxis</b>
              </span>
            </p>
          </div>
        </div>
      </aside>
      <div className="ps-auth-work">{children}</div>
    </div>
  );
}

/** The one header: the mark, the nav on its bottom edge, the theme switch, and the menu where the nav does not fit. */
function Header({ nav, home, brandSub }: { nav: ReadonlyArray<PublicNavItem>; home: string; brandSub?: string }) {
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const go = useSiteLink(close);
  const dropId = useId();
  const here = nav.find((n) => n.current)?.href;

  // A new page closes the menu; so does Esc while it is open.
  useEffect(close, [here, close]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <header className="ps-header">
      <div className="public-wrap ps-header-in">
        <a className="ps-brand" href={home} onClick={go(home)} aria-label="MyCityApp Home">
          <Brand name="MyCityApp" sub={brandSub} tile="deep" />
        </a>
        {nav.length > 0 && (
          <nav className="ps-nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.href + n.label} href={n.href} onClick={go(n.href)} aria-current={n.current ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
        )}
        <IconButton
          icon={theme === "dark" ? "sun" : "moon"}
          label={theme === "dark" ? "Light Theme" : "Dark Theme"}
          onClick={toggle}
          className="size-11 rounded-full text-foreground hover:bg-canvas-hover hover:text-foreground"
        />
        {nav.length > 0 && (
          <IconButton
            icon={menu ? "x" : "menu"}
            label="Menu"
            aria-expanded={menu}
            aria-controls={dropId}
            onClick={() => setMenu((m) => !m)}
            className="size-11 rounded-full xl:hidden text-foreground hover:bg-canvas-hover hover:text-foreground"
          />
        )}
      </div>
      {menu && (
        <nav id={dropId} className="ps-drop" aria-label="Menu">
          {nav.map((n) => (
            <a key={n.href + n.label} href={n.href} onClick={go(n.href)} aria-current={n.current ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

/** A Lagos skyline drawn as one silhouette along the footer's top edge. */
const EDGE =
  "M0 72V52h40V38h30v14h26V22h38v30h20V44h44V8h22v44h30V30h34v22h60V40h26V16h40v36h24V36h50v16h120l8-4h240l8 4h40V30h28v22h36V18h44v34h30V40h40v12h52V26h30v26h44V44h36v28z";

/** The foot of every public page: Deep Green under the skyline's edge, the mark and the time in Lagos, the columns, the © line and Back to Top. */
function Footer({
  columns,
  tagline,
  company,
  home,
  clear,
  children,
}: {
  columns: ReadonlyArray<PublicFooterColumn>;
  tagline: string;
  company: string;
  home: string;
  clear: boolean;
  children?: ReactNode;
}) {
  const now = useMinute();
  const go = useSiteLink();
  return (
    <footer data-theme="dark" className={cn("on-dark ps-foot", clear && "ps-foot-clear")}>
      <svg className="ps-foot-edge" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={EDGE} />
      </svg>
      <div className="public-wrap ps-foot-in">
        <div className="ps-foot-grid">
          <div>
            <a className="ps-brand" href={home} onClick={go(home)} aria-label="MyCityApp Home">
              <Brand name="MyCityApp" tile="secondary" />
            </a>
            <p className="ps-foot-tag">{tagline}</p>
            <span className="ps-clock">
              <Icon name="clock" size="m" />
              <span>Lagos</span>
              <time dateTime={now.toISOString()}>{lagosClock(now)}</time>
            </span>
          </div>
          {columns.length > 0 && (
            <nav aria-label="Site" className="ps-foot-nav">
              {columns.map((c) => (
                <div key={c.title}>
                  <h2>{c.title}</h2>
                  <ul>
                    {c.links.map((l) => (
                      <li key={l.label}>
                        <a href={l.href} onClick={go(l.href)}>
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </div>
        <div className="ps-foot-base">
          <span>
            © {lagosYear(now)} {company}
          </span>
          <span>
            Engineered by <b>JBS Praxis</b>
          </span>
          <button type="button" className="ps-top" aria-label="Back to Top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <Icon name="arrowup" size="m" />
          </button>
        </div>
      </div>
      {children != null && <div className="public-wrap ps-foot-more">{children}</div>}
    </footer>
  );
}

/** The tones a PageMessage takes. */
export type PageMessageTone = "neutral" | "ok" | "warn" | "err";

export interface PageMessageProps {
  /** The glyph in the circle; alert unless set. */
  icon?: IconName;
  /** The circle's tone; neutral unless set. */
  tone?: PageMessageTone;
  /** What happened, at most 4 words (Application Sent, Offer Signed). */
  title: ReactNode;
  /** One or two short sentences: what the person can do now. */
  children?: ReactNode;
  /** The reference to quote, in its dashed box under the words (Your Reference, APP-0042). */
  reference?: { label: string; value: string };
  /** One or two actions, usually Buttons. */
  action?: ReactNode;
}

/** A whole-page outcome on the public site: a bad link, an expired offer, an application sent. Its mark lands as it opens. */
export function PageMessage({ icon = "alert", tone = "neutral", title, children, reference, action }: PageMessageProps) {
  return (
    <div className="ps-outcome">
      <span aria-hidden="true" className="ps-outcome-ic" data-tone={tone}>
        <Icon name={icon} className="size-11" />
      </span>
      <h2 data-ui="title">{title}</h2>
      {children != null && <div className="ps-outcome-text">{children}</div>}
      {reference != null && (
        <div className="ps-ref">
          <span>{reference.label}</span>
          <b data-copy="content">{reference.value}</b>
        </div>
      )}
      {action != null && <div className="ps-outcome-acts">{action}</div>}
    </div>
  );
}
