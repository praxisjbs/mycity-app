import { useEffect, useState } from "react";
import { CommandPalette, toast, useDensity, useTheme, type IconName, type PaletteResult } from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import type { SearchHit } from "@mycity/contract/contract.gen.ts";
import { useAuth } from "@/auth/AuthProvider";
import { useClock } from "@/features/attendance/ClockButton";
import { testPush, turnOnPush } from "@/features/notifications/push";
import { openNotificationSettings } from "@/features/notifications/state";
import { useOpens, type Opens } from "@/lib/plan";
import { useRouter } from "@/lib/router";
import { useInstallApp } from "./Notices";
import { usePwa } from "./pwa";
import { refreshScreen, useReloadApp } from "./refresh";
import { useTextSizeSheet } from "./TextSize";

/**
 * Search, everywhere in the staff app: ⌘K or Ctrl K, the top bar's search
 * button, the phone's search icon and More's search bar (docs/guides/foundation.md
 * §6.7). GET /api/v1/search answers in groups, Screens, Actions and each kind of
 * record, each the first page of 25 and only what this person may open; the
 * server decides that. With nothing typed it offers what waits on the person
 * (Waiting on You, first), then the screens and actions.
 *
 * A result opens its link. An action with no screen of its own the app runs
 * here: Clock In or Out opens the clock, Mark All Read clears the bell, and the
 * theme, density, Install App and Sign Out do what the account menu does.
 * Install App is left out where this browser cannot install. Refresh Screen and
 * Reload App do what the pull and the refresh button do (F28), for anyone who
 * cannot pull or hold.
 *
 * A result that would only open Coming Soon in this build (F14: a screen, an action or a
 * record of a module not yet released, or a Home card counting one) is left out, for every
 * role, by the same rule the shell opens screens with (lib/plan.ts).
 */
const ICONS: Record<string, IconName> = {
  app_user: "user",
  employee: "user",
  department: "users",
  org_seat: "addbox",
  approval: "check",
  workflow_definition: "check",
  import_batch: "rows",
  attendance_days: "calendar",
};
const RUN_ICONS: Record<string, IconName> = {
  clock: "clock",
  read_all: "bell",
  notify_settings: "cog",
  notify_on: "bell",
  notify_test: "send",
  theme_dark: "moon",
  theme_light: "sun",
  density: "rows",
  text_size: "textsize",
  install: "download",
  refresh: "rotate",
  reload: "refresh",
  sign_out: "logout",
};

/** Whether a result is shown: Install App only where this browser can install, nothing that opens Coming Soon. */
export function shownHit(hit: SearchHit, { canInstall, opens }: { canInstall: boolean; opens: Pick<Opens, "link" | "module"> }): boolean {
  if (hit.run === "install" && !canInstall) return false;
  if (hit.link && !opens.link(hit.link)) return false;
  return !hit.module || opens.module(hit.module);
}

function iconOf(hit: SearchHit): IconName {
  if (hit.kind === "screen") return "right";
  if (hit.kind === "action") return (hit.run && RUN_ICONS[hit.run]) || "plus";
  return ICONS[hit.type] ?? "doc";
}

export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const clock = useClock();
  const { setTheme } = useTheme();
  const density = useDensity();
  const textSize = useTextSizeSheet();
  const { canInstall } = usePwa();
  const opens = useOpens();
  const installApp = useInstallApp();
  const reloadApp = useReloadApp();
  const { signOut } = useAuth();
  const [line, setLine] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(line.trim()), 250);
    return () => clearTimeout(t);
  }, [line]);
  const res = useApi("GET /api/v1/search", { query: q ? { q } : {}, enabled: open });

  const hits = new Map<string, SearchHit>();
  const results: PaletteResult[] = (res.data?.groups ?? []).flatMap((g) =>
    g.items.filter((hit) => shownHit(hit, { canInstall, opens })).map((hit) => {
      const key = `${g.type}:${hit.id}`;
      hits.set(key, hit);
      return { key, group: g.label, title: hit.title, subtitle: hit.sub ?? hit.ref ?? undefined, icon: iconOf(hit), href: hit.link ?? "" };
    }),
  );

  const choose = async (r: PaletteResult) => {
    const hit = hits.get(r.key);
    if (hit?.run === "clock") return clock.open();
    if (hit?.run === "theme_dark") return setTheme("dark");
    if (hit?.run === "theme_light") return setTheme("light");
    if (hit?.run === "density") return density.toggle();
    if (hit?.run === "text_size") return textSize();
    if (hit?.run === "install") return installApp();
    if (hit?.run === "refresh") return refreshScreen();
    if (hit?.run === "reload") return reloadApp();
    if (hit?.run === "sign_out") return void signOut();
    if (hit?.run === "notify_settings") return openNotificationSettings();
    if (hit?.run === "notify_on") return void (await turnOnPush());
    if (hit?.run === "notify_test") return testPush();
    if (hit?.run === "read_all") {
      try {
        await api.call("POST /api/v1/notifications/read-all", { body: {} });
        invalidate("/api/v1/notifications");
        toast("All notifications read");
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Something went wrong");
      }
      return;
    }
    if (r.href) navigate(r.href);
  };

  return (
    <CommandPalette
      open={open}
      onClose={() => {
        setLine("");
        setQ("");
        onClose();
      }}
      query={line}
      onQueryChange={setLine}
      results={results}
      loading={res.loading || line.trim() !== q}
      onSelect={(r) => void choose(r)}
    />
  );
}
