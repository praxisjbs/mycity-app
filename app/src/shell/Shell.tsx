import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  Avatar,
  BottomBar,
  DesktopShell,
  ErrorBoundary,
  goHistory,
  IconButton,
  NavCapsule,
  PhoneHeader,
  PhoneShell,
  Rail,
  SearchButton,
  Skeleton,
  Tabs,
  TopBar,
  TrailMenu,
  useDensity,
  useInstalled,
  useIsPhone,
  useTheme,
  type MenuItem,
  type TrailItem,
} from "@mycity/ui";
import { useApi } from "@/api/hooks";
import { useAuth, useMe, useMyPhoto } from "@/auth/AuthProvider";
import { ClockButton, ClockPrompts, useClockSync } from "@/features/attendance/ClockButton";
import { AcknowledgePrompts } from "@/features/policies/AcknowledgeSheet";
import { UrgentNotices, urgentModules, useUrgentNotices } from "@/features/notifications/UrgentNotices";
import { useScreenState } from "@/lib/plan";
import { hrefFor, moduleKeyOf, useRouter } from "@/lib/router";
import { goTrail, startTrail, useTrail } from "@/lib/trail";
import { visibleModules, visibleTabs } from "./access";
import { BellButton } from "./Bell";
import { moduleByKey, type ModuleDef, type TabDef } from "./catalogue";
import { Fab } from "./Fab";
import { FitContext } from "./layout-context";
import { More } from "./More";
import { bottomItems, bottomKey, railItems } from "./nav";
import { ShellNotices, useInstallApp } from "./Notices";
import { OfflinePage, useOnline } from "./offline";
import { PlannedScreen, ViewBar } from "./Planned";
import { noteVisit, usePwa } from "./pwa";
import { refreshScreen, useReloadApp } from "./refresh";
import { SCREENS } from "./screens";
import { ScreenActionProvider } from "./screen-action";
import { Search } from "./Search";
import { nameOfPlace, trailItems } from "./trail-items";
import { useTextSizeSheet } from "./TextSize";

/**
 * The staff app's frame, on the Shell group of @mycity/ui. Two shells, not one
 * layout scaled (gate 11), chosen by useIsPhone (760 px):
 *
 *   desktop  DesktopShell: the Rail (collapsible, remembered in mc-rail), the
 *            TopBar (search, clock, bell), the module's tabs, the page
 *   phone    PhoneShell: PhoneHeader (the pin; search, bell, the avatar that
 *            opens More; the module's name over its tabs), the page, the
 *            FloatingButton (F18) and the BottomBar (F16) with More (F17)
 *
 * Navigation comes from the /me grants (access.ts) and the one URL shape,
 * /<module>?tab=<tab>&id=<id> (lib/router.tsx). An unknown module or tab, or
 * one the person may not open, lands on the first allowed screen. What a
 * screen shows before its milestone is the delivery plan's call (F14,
 * lib/plan.ts). ⌘K or Ctrl K opens search anywhere.
 *
 * Refresh and history (F28, F29): the phone's page pulls to refresh (a second
 * notch reloads); desktop has the capsule at the start of the top bar, refresh
 * everywhere and, in the installed app, back and forward. The installed app's
 * trail (an arrow or the pin held) is this device's own (lib/trail.ts).
 */
export function Shell() {
  const me = useMe();
  const phone = useIsPhone();
  const { location, navigate } = useRouter();
  const modules = useMemo(() => visibleModules(me), [me]);
  const { data: badges } = useApi("GET /api/v1/notifications/badges");
  const urgentRows = useUrgentNotices();
  const urgent = useMemo(() => urgentModules(urgentRows), [urgentRows]);

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
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = allowed && tab ? `${tab.label} · ${allowed.label} · MyCity App` : "MyCity App";
  }, [allowed, tab]);

  useEffect(() => noteVisit(), []);
  useClockSync();

  // This device's trail for this person: put back from the last session, or started afresh (F29).
  useLayoutEffect(() => {
    if (startTrail(me.user_id) === "home") navigate(hrefFor("home"), { replace: true });
  }, [me.user_id, navigate]);
  const trail = useTrail();
  const installed = useInstalled();
  const reloadApp = useReloadApp();
  const [trailOpen, setTrailOpen] = useState(false);
  const history: HistoryProps = {
    installed,
    items: useMemo(() => trailItems(trail), [trail]),
    back: nameOfPlace(trail.places[trail.index - 1]),
    forward: nameOfPlace(trail.places[trail.index + 1]),
    trailOpen,
    setTrailOpen,
    reloadApp,
  };

  const page = allowed && tab ? <ModulePage mod={allowed} tab={tab} id={location.id} /> : null;
  const strip =
    allowed && tab ? (
      <Tabs
        label={allowed.label}
        value={tab.slug}
        onValueChange={(slug) => navigate(hrefFor(allowed.key, slug))}
        items={tabs.map((t) => ({ value: t.slug, label: t.label, href: hrefFor(allowed.key, t.slug) }))}
      />
    ) : undefined;
  const frame: FrameProps = {
    modules,
    mod: allowed,
    tab,
    tabs: strip,
    page,
    fit,
    badges,
    urgent,
    alert: <UrgentNotices rows={urgentRows} />,
    openSearch,
    path: `${location.path}?tab=${tab?.slug ?? ""}`,
    history,
  };

  return (
    <FitContext.Provider value={useCallback((f: boolean) => setFit(f), [])}>
      <ScreenActionProvider>
        {phone ? <PhoneFrame {...frame} /> : <DesktopFrame {...frame} />}
        <Search open={search} onClose={() => setSearch(false)} />
        <ClockPrompts />
        <AcknowledgePrompts />
      </ScreenActionProvider>
    </FitContext.Provider>
  );
}

interface FrameProps {
  modules: ModuleDef[];
  mod: ModuleDef | null;
  tab: TabDef | undefined;
  tabs: ReactNode;
  page: ReactNode;
  fit: boolean;
  badges: Record<string, number> | undefined;
  /** Modules an open urgent notice is about: their badges show red. */
  urgent: Set<string>;
  /** The urgent bar, under the top bar on every screen. */
  alert: ReactNode;
  openSearch: () => void;
  /** The screen in view (path and tab): a new one resets the scroll and Hide Here. */
  path: string;
  /** Refresh, reload, back, forward and the trail (F28, F29). */
  history: HistoryProps;
}

interface HistoryProps {
  /** Running as an installed app: back, forward and the trail show only then. */
  installed: boolean;
  items: TrailItem[];
  /** Where Back and Forward go, by name. */
  back: string | null;
  forward: string | null;
  trailOpen: boolean;
  setTrailOpen: (open: boolean) => void;
  reloadApp: () => Promise<void>;
}

const RAIL_KEY = "mc-rail";
function readCollapsed() {
  try {
    return localStorage.getItem(RAIL_KEY) === "slim";
  } catch {
    return false;
  }
}

function DesktopFrame({ modules, mod, tabs, page, fit, badges, urgent, alert, openSearch, history }: FrameProps) {
  const me = useMe();
  const photo = useMyPhoto();
  const { navigate } = useRouter();
  const menu = useAccountMenu();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? "wide" : "slim");
      } catch {
        /* a per-device convenience; fine to lose */
      }
      return !c;
    });
  return (
    <DesktopShell
      fit={fit}
      rail={
        <Rail
          items={railItems(modules, badges, urgent)}
          current={mod?.key ?? null}
          collapsed={collapsed}
          onNavigate={navigate}
          homeHref={hrefFor("home")}
          onBrandHold={history.installed ? () => history.setTrailOpen(true) : undefined}
          account={{ name: me.display_name, subtitle: me.job_title, photo, menu }}
          foot={
            <>
              Engineered by{" "}
              <a className="font-semibold text-primary no-underline hover:underline" href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer">
                JBS Praxis
              </a>
            </>
          }
        />
      }
      topBar={
        <TopBar
          start={
            <>
              <IconButton icon="panel" label={collapsed ? "Expand Menu" : "Collapse Menu"} onClick={toggle} />
              <NavCapsule
                arrows={history.installed}
                back={history.back}
                forward={history.forward}
                onBack={() => goHistory(-1)}
                onForward={() => goHistory(1)}
                onRefresh={refreshScreen}
                onReload={history.reloadApp}
                trail={history.items}
                onGo={goTrail}
                trailOpen={history.trailOpen}
                onTrailOpenChange={history.setTrailOpen}
              />
            </>
          }
          search={<SearchButton onClick={openSearch} />}
          actions={
            <>
              <ClockButton />
              <BellButton />
            </>
          }
        />
      }
      tabs={tabs}
      alert={alert}
      notice={<ShellNotices />}
    >
      {page}
    </DesktopShell>
  );
}

/** The desktop account menu: the person's own screens, theme, density, text size, Install App, Sign Out. */
function useAccountMenu(): MenuItem[] {
  const { signOut } = useAuth();
  const { navigate } = useRouter();
  const { theme, toggle } = useTheme();
  const density = useDensity();
  const textSize = useTextSizeSheet();
  const { canInstall } = usePwa();
  const installApp = useInstallApp();
  return [
    { label: "My Profile", icon: "user", onSelect: () => navigate(hrefFor("ess", "my-profile")) },
    { label: "My Security", icon: "shield", onSelect: () => navigate(hrefFor("ess", "my-security")) },
    "sep",
    { label: theme === "dark" ? "Light Theme" : "Dark Theme", icon: theme === "dark" ? "sun" : "moon", onSelect: toggle },
    { label: density.density === "compact" ? "Comfortable Density" : "Compact Density", icon: "rows", onSelect: density.toggle },
    { label: "Text Size", icon: "textsize", onSelect: textSize },
    ...(canInstall ? [{ label: "Install App", icon: "download" as const, onSelect: installApp }] : []),
    "sep",
    { label: "Sign Out", icon: "logout", onSelect: () => void signOut() },
  ];
}

function PhoneFrame({ modules, mod, tabs, page, fit, badges, urgent, alert, openSearch, path, history }: FrameProps) {
  const me = useMe();
  const photo = useMyPhoto();
  const { navigate } = useRouter();
  const [more, setMore] = useState(false);
  return (
    <>
      <PhoneShell
        pageKey={path}
        fit={fit}
        onRefresh={refreshScreen}
        onReload={history.reloadApp}
        header={
          <PhoneHeader
            title={mod?.label}
            homeHref={hrefFor("home")}
            onNavigate={navigate}
            onPinHold={history.installed ? () => history.setTrailOpen(true) : undefined}
            tabs={tabs}
            actions={
              <>
                <IconButton icon="srch" label="Search" onClick={openSearch} />
                <BellButton />
                <button type="button" aria-label="Your Account" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)} className="flex size-tap items-center justify-center rounded-full">
                  <Avatar name={me.display_name} src={photo} size="sm" tone="brand" />
                </button>
              </>
            }
          />
        }
        bottomBar={<BottomBar items={bottomItems(modules, badges, () => setMore(true), more, urgent)} current={more ? "more" : bottomKey(mod?.key ?? null)} onNavigate={navigate} />}
        fab={<Fab page={path} />}
        alert={alert}
        notice={<ShellNotices />}
      >
        {page}
      </PhoneShell>
      <More open={more} onClose={() => setMore(false)} modules={modules} badges={badges} current={mod?.key ?? null} onSearch={openSearch} />
      {history.installed && <TrailMenu open={history.trailOpen} onOpenChange={history.setTrailOpen} items={history.items} onGo={goTrail} />}
    </>
  );
}

/** A mock build (laptops and CI); a live build drops the Prototype View switch entirely. */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

/**
 * One screen, as the delivery plan allows (F14): Coming Soon before its
 * milestone opens it; in mock mode (laptops and CI) the Prototype View switch
 * above it. With no connection, the offline page instead.
 */
function ModulePage({ mod, tab, id }: { mod: ModuleDef; tab: TabDef; id: string | null }) {
  const Screen = SCREENS[mod.key];
  const state = useScreenState(mod.key, tab.slug);
  const online = useOnline();
  if (!online) return <OfflinePage />;
  return (
    <>
      {MOCK && state.rule === "mock" && <ViewBar />}
      {state.open ? (
        <ErrorBoundary key={`${mod.key}:${tab.slug}`}>
          <Suspense fallback={<Skeleton lines={6} />}>
            <Screen tab={tab.slug} id={id} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <PlannedScreen moduleKey={mod.key} tab={tab.slug} label={tab.label} m={state.screen?.m ?? "M11"} mock={MOCK && state.rule === "mock"} />
      )}
    </>
  );
}

