import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMe, useAuth } from "@/auth/AuthProvider";
import { IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/data";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { LoadingRows } from "@/components/ui/Table";
import { ClockButton } from "@/features/attendance/ClockButton";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/lib/media";
import { hrefFor, Link, moduleKeyOf, useRouter } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/api/hooks";
import { visibleModules, visibleTabs } from "./access";
import { MOBILE_BAR, moduleByKey, type ModuleDef, type TabDef } from "./catalogue";
import { CommandPalette } from "./CommandPalette";
import { useBell } from "./Bell";
import { NavList } from "./Nav";
import { FitContext } from "./layout-context";
import { SCREENS } from "./screens";
import { ComingSoon, ViewBar } from "./Planned";
import { useScreenState } from "@/lib/plan";

/**
 * The staff app's frame. Two shells, not one layout scaled (gate 11):
 *   desktop  Deep Green rail, top bar, tab strip, dense content
 *   mobile   compact top bar, scrolling tabs, bottom icon bar, menu drawer
 * Both render the same screens from the same route.
 */
export function Shell() {
  const me = useMe();
  const mobile = useIsMobile();
  const { location, navigate } = useRouter();
  const modules = useMemo(() => visibleModules(me), [me]);

  const key = location.module ? moduleKeyOf(location.module) : null;
  const mod = moduleByKey(key);
  const allowed = mod && modules.includes(mod) ? mod : null;
  const tabs = allowed ? visibleTabs(me, allowed) : [];
  const tab = tabs.find((t) => t.slug === location.tab) ?? tabs[0];

  /* Unknown module, a module this person cannot open, or no tab: land on the first allowed screen. */
  useEffect(() => {
    if (!modules.length) return;
    if (!allowed) navigate(hrefFor(modules[0].key, visibleTabs(me, modules[0])[0]?.slug), { replace: true });
    else if (tab && location.tab !== tab.slug) navigate(hrefFor(allowed.key, tab.slug, Object.fromEntries([...location.params].filter(([k]) => k !== "tab"))), { replace: true });
  }, [allowed, tab, location, modules, me, navigate]);

  const [fit, setFit] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = allowed && tab ? `${tab.label} · ${allowed.label} · MyCity App` : "MyCity App";
  }, [allowed, tab]);

  const page = allowed && tab ? <ModulePage mod={allowed} tab={tab} id={location.id} /> : null;
  const frame = { modules, mod: allowed, tabs, tab, page, fit, openPalette: () => setPalette(true) };

  return (
    <FitContext.Provider value={useCallback((f: boolean) => setFit(f), [])}>
      {mobile ? <MobileShell {...frame} /> : <DesktopShell {...frame} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </FitContext.Provider>
  );
}

interface FrameProps {
  modules: ModuleDef[];
  mod: ModuleDef | null;
  tabs: TabDef[];
  tab: TabDef | undefined;
  page: ReactNode;
  fit: boolean;
  openPalette: () => void;
}

function readSlim() {
  try {
    return localStorage.getItem("mc-rail") === "slim";
  } catch {
    return false;
  }
}

function DesktopShell({ modules, mod, tabs, tab, page, fit, openPalette }: FrameProps) {
  const [slim, setSlim] = useState(readSlim);
  const toggle = () =>
    setSlim((s) => {
      try {
        localStorage.setItem("mc-rail", s ? "wide" : "slim");
      } catch {
        /* a per-device convenience; fine to lose */
      }
      return !s;
    });
  return (
    <div className="grid h-full grid-cols-[auto_1fr] grid-rows-[minmax(0,100%)]">
      <aside className={cn("on-dark flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200", slim ? "w-[66px]" : "w-[248px]")}>
        <RailTop slim={slim} />
        <NavList modules={modules} current={mod?.key ?? null} slim={slim} />
        <RailFoot slim={slim} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col bg-muted">
        <header className="flex min-h-[58px] flex-none items-center gap-2.5 border-b border-border bg-background px-4">
          <IconButton icon="menu" label={slim ? "Expand menu" : "Collapse menu"} onClick={toggle} />
          <SearchPill onClick={openPalette} />
          <ClockButton />
          <BellButton />
          <ThemeButton />
        </header>
        <TabStrip mod={mod} tabs={tabs} tab={tab} />
        <FitMain fit={fit}>{page}</FitMain>
      </div>
    </div>
  );
}

function MobileShell({ modules, mod, tabs, tab, page, openPalette }: FrameProps) {
  const [drawer, setDrawer] = useState(false);
  const me = useMe();
  const bar = MOBILE_BAR.filter((b) => me.grants[b.key]?.includes("view"));
  return (
    <div className="flex h-full flex-col bg-muted">
      <header className="pt-safe flex min-h-[58px] flex-none items-center gap-2 border-b border-border bg-background px-3">
        <IconButton icon="menu" label="Open menu" onClick={() => setDrawer(true)} />
        <SearchPill onClick={openPalette} compact />
        <ClockButton compact />
        <BellButton />
        <ThemeButton />
      </header>
      <TabStrip mod={mod} tabs={tabs} tab={tab} />
      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[14px] pt-[14px] pb-[90px]">{page}</main>
      <nav className="on-dark pb-safe fixed inset-x-0 bottom-0 z-50 flex border-t border-sidebar-border bg-sidebar px-1 pt-1.5" aria-label="Main">
        {bar.map((b) => {
          const on = mod?.key === b.key;
          return (
            <Link
              key={b.key}
              to={hrefFor(b.key)}
              aria-current={on ? "page" : undefined}
              className={cn("mb-1.5 flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] rounded-box px-0.5 py-[7px] text-[10px] font-semibold no-underline", on ? "text-primary [&_svg]:[stroke-width:2.1]" : "text-sidebar-muted")}
            >
              <Icon name={b.icon} size="m" />
              {b.label}
            </Link>
          );
        })}
      </nav>
      {drawer && (
        <>
          <div className="fixed inset-0 z-[71] bg-scrim" onClick={() => setDrawer(false)} />
          <aside className="on-dark pt-safe fixed top-(--env-bar) bottom-0 left-0 z-[72] flex w-[280px] max-w-[84vw] animate-slide-in flex-col bg-sidebar text-sidebar-foreground shadow-3" aria-label="Menu">
            <RailTop />
            <NavList modules={modules} current={mod?.key ?? null} onNavigate={() => setDrawer(false)} />
            <RailFoot />
          </aside>
        </>
      )}
    </div>
  );
}

function RailTop({ slim }: { slim?: boolean }) {
  return (
    <div className="flex min-h-[58px] flex-none items-center gap-2.5 px-4 pt-4 pb-3">
      <Icon name="pin" className="size-6 text-primary" />
      <b className={cn("text-[14.5px] font-bold tracking-[-.015em] whitespace-nowrap transition-opacity", slim && "opacity-0")}>MyCity App</b>
    </div>
  );
}

function RailFoot({ slim }: { slim?: boolean }) {
  const me = useMe();
  const { signOut } = useAuth();
  const { navigate } = useRouter();
  return (
    <div className="flex flex-none flex-col gap-2 border-t border-sidebar-border p-2.5">
      <Menu
        align="start"
        trigger={(p) => (
          <button {...p} type="button" className="flex min-w-0 items-center gap-2.5 rounded-ctl text-left hover:bg-sidebar-hover" title={slim ? me.display_name : undefined}>
            <Avatar name={me.display_name} size={32} tone="brand" />
            <span className={cn("min-w-0 leading-tight transition-opacity", slim && "opacity-0")}>
              <b className="block truncate text-[12.5px] font-semibold">{me.display_name}</b>
              <span className="text-[11px] text-sidebar-muted">{me.job_title}</span>
            </span>
          </button>
        )}
        items={[
          { label: "My Profile", icon: "user", onSelect: () => navigate(hrefFor("ess", "my-profile")) },
          { label: "My Security", icon: "shield", onSelect: () => navigate(hrefFor("ess", "my-security")) },
          "sep",
          { label: "Sign Out", icon: "lock", onSelect: () => void signOut() },
        ]}
      />
      <span className={cn("pl-0.5 text-[10.5px] whitespace-nowrap text-sidebar-muted transition-opacity", slim && "opacity-0")}>
        Engineered by{" "}
        <a className="font-semibold text-primary no-underline hover:underline" href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer">
          JBS Praxis
        </a>
      </span>
    </div>
  );
}

function SearchPill({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-muted px-3 text-[13px] text-subtle-foreground hover:border-input", !compact && "max-w-[380px]")}
    >
      <Icon name="srch" />
      <span className="truncate">Search anything</span>
      {!compact && <kbd className="ml-auto rounded-[5px] border border-border bg-background px-[5px] py-px font-sans text-[11px]">{mac ? "⌘K" : "Ctrl K"}</kbd>}
    </button>
  );
}

function BellButton() {
  const { data } = useApi("GET /api/v1/notifications", { query: { unread: true } });
  const open = useBell();
  return <IconButton icon="bell" label="Notifications and alerts" dot={!!data?.page.total} onClick={open} />;
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggle} />;
}

function TabStrip({ mod, tabs, tab }: { mod: ModuleDef | null; tabs: TabDef[]; tab: TabDef | undefined }) {
  const { location } = useRouter();
  if (!mod) return <div className="h-[43px] flex-none border-b border-border bg-background" />;
  return (
    <div className="no-scrollbar flex flex-none gap-0.5 overflow-x-auto border-b border-border bg-background px-4 max-md:px-3" role="tablist" aria-label={mod.label}>
      {tabs.map((t) => {
        const on = t.slug === tab?.slug && !location.id;
        const sel = t.slug === tab?.slug;
        return (
          <Link
            key={t.slug}
            to={hrefFor(mod.key, t.slug)}
            role="tab"
            aria-selected={sel}
            className={cn(
              "-mb-px border-b-2 px-3 py-[11px] text-[13px] whitespace-nowrap no-underline transition-colors",
              on ? "border-primary font-[650] text-foreground" : "border-transparent font-[550] text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A fit page (chat, mailbox) does not scroll. Scrolling down past the end of a
 * pane slides the page header away so the panes get the full height; scrolling
 * up at the top of a pane, or over something that does not scroll, brings it back.
 */
function FitMain({ fit, children }: { fit: boolean; children: ReactNode }) {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    if (!fit) setHide(false);
  }, [fit]);
  const onWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (!fit || Math.abs(e.deltaY) < 4) return;
    let pane: HTMLElement | null = e.target as HTMLElement;
    while (pane && pane !== e.currentTarget && !(pane.scrollHeight > pane.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
    const scrolls = pane && pane !== e.currentTarget;
    const top = !scrolls || pane!.scrollTop <= 0;
    const end = !scrolls || pane!.scrollTop + pane!.clientHeight >= pane!.scrollHeight - 2;
    if (e.deltaY > 0 && end && !hide) setHide(true);
    else if (e.deltaY < 0 && top && hide) setHide(false);
  };
  return (
    <main onWheel={onWheel} className={cn("min-h-0 flex-1 overflow-x-hidden px-4", fit ? "flex flex-col overflow-y-hidden pb-4" : "overflow-y-auto pt-[18px] pb-11", fit && (hide ? "pt-2.5" : "pt-[18px]"))}>
      <div className={cn("mx-auto w-full max-w-[1340px]", fit && "fit-page flex min-h-0 flex-1 flex-col", hide && "hidehead")}>{children}</div>
    </main>
  );
}

/**
 * One screen, as the delivery plan allows (lib/plan.ts): on production, Coming
 * Soon until its PROGRESS row is ticked; elsewhere, the prototype view switch
 * above it, and Coming Soon when the view is set before its milestone.
 */
function ModulePage({ mod, tab, id }: { mod: ModuleDef; tab: TabDef; id: string | null }) {
  const Screen = SCREENS[mod.key];
  const state = useScreenState(mod.key, tab.slug);
  return (
    <>
      {!state.production && <ViewBar />}
      {state.open ? (
        <ErrorBoundary key={`${mod.key}:${tab.slug}`}>
          <Suspense fallback={<LoadingRows count={6} />}>
            <Screen tab={tab.slug} id={id} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <ComingSoon moduleKey={mod.key} tab={tab.slug} label={tab.label} m={state.plan?.m ?? "M11"} production={state.production} />
      )}
    </>
  );
}
