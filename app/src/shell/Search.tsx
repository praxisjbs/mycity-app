import { useEffect, useState } from "react";
import { CommandPalette, toast, type IconName, type PaletteResult } from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import type { SearchHit } from "@mycity/contract/contract.gen.ts";
import { useClock } from "@/features/attendance/ClockButton";
import { useRouter } from "@/lib/router";

/**
 * Search, everywhere in the staff app: ⌘K or Ctrl K, the top bar's search
 * button, the phone's search icon and More's search bar (docs/guides/foundation.md
 * §6.7). GET /api/v1/search answers in groups, Screens, Actions and each kind of
 * record, each the first page of 25 and only what this person may open; the
 * server decides that. With nothing typed it offers the screens and actions.
 *
 * A result opens its link. An action with no screen of its own the app runs
 * here: Clock In or Out opens the clock, Mark All Read clears the bell.
 */
const ICONS: Record<string, IconName> = { app_user: "user", employee: "user", department: "users", workflow_definition: "check", import_batch: "rows" };

function iconOf(hit: SearchHit): IconName {
  if (hit.kind === "screen") return "right";
  if (hit.kind === "action") return hit.run === "clock" ? "clock" : hit.run === "read_all" ? "bell" : "plus";
  return ICONS[hit.type] ?? "doc";
}

export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const clock = useClock();
  const [line, setLine] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(line.trim()), 250);
    return () => clearTimeout(t);
  }, [line]);
  const res = useApi("GET /api/v1/search", { query: q ? { q } : {}, enabled: open });

  const hits = new Map<string, SearchHit>();
  const results: PaletteResult[] = (res.data?.groups ?? []).flatMap((g) =>
    g.items.map((hit) => {
      const key = `${g.type}:${hit.id}`;
      hits.set(key, hit);
      return { key, group: g.label, title: hit.title, subtitle: hit.sub ?? hit.ref ?? undefined, icon: iconOf(hit), href: hit.link ?? "" };
    }),
  );

  const choose = async (r: PaletteResult) => {
    const hit = hits.get(r.key);
    if (hit?.run === "clock") return clock.open();
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
