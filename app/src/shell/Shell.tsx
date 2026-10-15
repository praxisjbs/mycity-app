import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Avatar,
  BottomBar,
  DesktopShell,
  ErrorBoundary,
  IconButton,
  PhoneHeader,
  PhoneShell,
  Rail,
  SearchButton,
  Skeleton,
  Tabs,
  TopBar,
  useDensity,
  useIsPhone,
  useTheme,
  type MenuItem,
} from "@mycity/ui";
import { useApi } from "@/api/hooks";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { ClockButton, useClockPrompt } from "@/features/attendance/ClockButton";
import { useScreenState } from "@/lib/plan";
import { hrefFor, moduleKeyOf, useRouter } from "@/lib/router";
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
import { SCREENS } from "./screens";
import { ScreenActionProvider } from "./screen-action";
import { Search } from "./Search";

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
 */
export function Shell() {
  const me = useMe();
  const phone = useIsPhone();
  const { location, navigate } = useRouter();
  const modules = useMemo(() => visibleModules(me), [me]);
  const { data: badges } = useApi("GET /api/v1/notifications/badges");

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
  useClockPrompt();

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
  const frame: FrameProps = { modules, mod: allowed, tab, tabs: strip, page, fit, badges, openSearch, path: `${location.path}?tab=${tab?.slug ?? ""}` };

  return (
    <FitContext.Provider value={useCallback((f: boolean) => setFit(f), [])}>
      <ScreenActionProvider>
        {phone ? <PhoneFrame {...frame} /> : <DesktopFrame {...frame} />}
        <Search open={search} onClose={() => setSearch(false)} />
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
  openSearch: () => void;
  /** The screen in view (path and tab): a new one resets the scroll and Hide Here. */
  path: string;
}

const RAIL_KEY = "mc-rail";
function readCollapsed() {
  try {
    return localStorage.getItem(RAIL_KEY) === "slim";
  } catch {
    return false;
  }
}

function DesktopFrame({ modules, mod, tabs, page, fit, badges, openSearch }: FrameProps) {
  const me = useMe();
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
          items={railItems(modules, badges)}
          current={mod?.key ?? null}
          collapsed={collapsed}
          onNavigate={navigate}
          account={{ name: me.display_name, subtitle: me.job_title, photo: me.photo_url, menu }}
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
          start={<IconButton icon="panel" label={collapsed ? "Expand Menu" : "Collapse Menu"} onClick={toggle} />}
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
      notice={<ShellNotices />}
    >
      {page}
    </DesktopShell>
  );
}

/** The desktop account menu: the person's own screens, theme, density, Install App, Sign Out. */
function useAccountMenu(): MenuItem[] {
  const { signOut } = useAuth();
  const { navigate } = useRouter();
  const { theme, toggle } = useTheme();
  const density = useDensity();
  const { canInstall } = usePwa();
  const installApp = useInstallApp();
  return [
    { label: "My Profile", icon: "user", onSelect: () => navigate(hrefFor("ess", "my-profile")) },
    { label: "My Security", icon: "shield", onSelect: () => navigate(hrefFor("ess", "my-security")) },
    "sep",
    { label: theme === "dark" ? "Light Theme" : "Dark Theme", icon: theme === "dark" ? "sun" : "moon", onSelect: toggle },
    { label: density.density === "compact" ? "Comfortable Density" : "Compact Density", icon: "rows", onSelect: density.toggle },
    ...(canInstall ? [{ label: "Install App", icon: "download" as const, onSelect: installApp }] : []),
    "sep",
    { label: "Sign Out", icon: "logout", onSelect: () => void signOut() },
  ];
}

function PhoneFrame({ modules, mod, tabs, page, fit, badges, openSearch, path }: FrameProps) {
  const me = useMe();
  const { navigate } = useRouter();
  const [more, setMore] = useState(false);
  return (
    <>
      <PhoneShell
        pageKey={path}
        fit={fit}
        header={
          <PhoneHeader
            title={mod?.label}
            homeHref={hrefFor("home")}
            onNavigate={navigate}
            tabs={tabs}
            actions={
              <>
                <IconButton icon="srch" label="Search" onClick={openSearch} />
                <BellButton />
                <button type="button" aria-label="Your Account" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)} className="flex size-tap items-center justify-center rounded-full">
                  <Avatar name={me.display_name} src={me.photo_url} size="sm" tone="brand" />
                </button>
              </>
            }
          />
        }
        bottomBar={<BottomBar items={bottomItems(modules, badges, () => setMore(true), more)} current={more ? "more" : bottomKey(mod?.key ?? null)} onNavigate={navigate} />}
        fab={<Fab page={path} />}
        notice={<ShellNotices />}
      >
        {page}
      </PhoneShell>
      <More open={more} onClose={() => setMore(false)} modules={modules} badges={badges} current={mod?.key ?? null} onSearch={openSearch} />
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

