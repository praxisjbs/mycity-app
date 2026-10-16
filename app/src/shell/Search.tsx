import { CommandPalette, type PaletteResult } from "@mycity/ui";
import { usePaged } from "@/api/hooks";
import type { SearchHit } from "@/api/types/identity";
import { useRouter } from "@/lib/router";

/**
 * Search, everywhere in the staff app: ⌘K or Ctrl K, the top bar's search
 * button, the phone's search icon and More's search bar. Screens and records
 * from the server's search registry (src/shared/search), first page only: it
 * pages at 25 like every list, filtered by the person's grants on the server.
 * With nothing typed, it lists the screens.
 */
export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const list = usePaged("GET /api/v1/search", { enabled: open });
  const hits: SearchHit[] = list.q.trim() ? list.rows : list.rows.filter((r) => r.kind === "screen");
  const results: PaletteResult[] = hits.map((r, i) => ({
    key: `${r.path}#${i}`,
    group: r.group,
    title: r.title,
    subtitle: r.subtitle,
    icon: r.kind === "screen" ? "right" : "user",
    href: r.path,
  }));
  return (
    <CommandPalette
      open={open}
      onClose={() => {
        list.setQ("");
        onClose();
      }}
      query={list.q}
      onQueryChange={list.setQ}
      results={results}
      loading={list.loading}
      onSelect={(r) => navigate(r.href)}
    />
  );
}
