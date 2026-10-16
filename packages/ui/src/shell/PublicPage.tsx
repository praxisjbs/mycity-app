/**
 * @component PublicPage
 * @group Shell
 * @summary The public site's page: the mark and the theme switch on top, the page on one card at most 704 px wide, and a short footer.
 * @use Every page of go.mycityapp.io (careers, a vacancy, apply, assessment, sign, verify); PageMessage is a whole-page outcome inside it (sent, expired, not found).
 * @avoid The staff app (it has its own shells); a second card inside the card; a page of explanation (a PageMessage says one thing).
 * @phone The card runs edge to edge with no side border; the header and footer keep a 16 px margin; the theme switch is a 44 px target.
 * @a11y A banner, a main and a contentinfo landmark; the theme switch is a named button. PageMessage's title is a heading (h2) and its icon is decorative.
 * @status stable
 * @exports PageMessage
 * @example <PublicPage brand={<a href="/jobs"><Brand name="MyCityApp" /></a>} links={<a href="/verify">Verify a Document</a>}>...</PublicPage>
 * @example <PageMessage icon="ok" tone="ok" title="Application Sent">We reply within five working days.</PageMessage>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../lib/preferences";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";

export interface PublicPageProps {
  /** The mark at the top left, usually a link home with Brand; left out when the page draws its own inside the card. */
  brand?: ReactNode;
  /** The page, drawn on the card. */
  children: ReactNode;
  /** Anything under the card (a second action, a note from the system). */
  below?: ReactNode;
  /** The footer's links (Careers, Verify a Document). */
  links?: ReactNode;
  /** The company line at the foot; MyCity App Ltd · Lagos, Nigeria unless set. */
  company?: string;
  /** More at the very foot (the mock's demo links, on a laptop only). */
  foot?: ReactNode;
  /** false draws the page without its main landmark, inside another page (the gallery). Default true. */
  landmarks?: boolean;
}

const WIDTH = "mx-auto w-full max-w-176";

export function PublicPage({ brand, children, below, links, company = "MyCity App Ltd · Lagos, Nigeria", foot, landmarks = true }: PublicPageProps) {
  const { theme, toggle } = useTheme();
  const Main = landmarks ? "main" : "div";
  return (
    <div className="flex flex-1 flex-col">
      <header className={cn(WIDTH, "flex items-center justify-between px-6 pt-5 pb-3 phone:px-4")}>
        <span className="*:inline-flex *:min-h-tap *:items-center">{brand}</span>
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light Theme" : "Dark Theme"} onClick={toggle} />
      </header>
      <Main className={cn(WIDTH, "flex-1 px-6 pb-6 phone:px-0")}>
        <div className="animate-rise rounded-card border border-border bg-background p-6 phone:rounded-none phone:border-x-0 phone:p-4">{children}</div>
        {below}
      </Main>
      <footer className={cn(WIDTH, "px-6 pb-6 text-xs text-subtle-foreground phone:px-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
          <span>{company}</span>
          {links != null && <span className="flex flex-wrap gap-3.5 phone:*:inline-flex phone:*:min-h-tap phone:*:min-w-tap phone:*:items-center">{links}</span>}
        </div>
        {foot}
      </footer>
    </div>
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

/** A whole-page outcome on the public site: a bad link, an expired offer, an application sent. */
export function PageMessage({ icon = "alert", tone = "neutral", title, children, action }: PageMessageProps) {
  return (
    <div className="py-6 text-center">
      <span className={cn("mx-auto flex size-14 items-center justify-center rounded-full", TONE[tone])}>
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
