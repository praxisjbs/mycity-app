import { useInfinite } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import { Pill, TapList } from "@mycity/ui";

/**
 * Procedures, under a screen's section of the User Guide (docs/guides/knowledge.md §3 step 3, §10):
 * the published department SOPs whose steps happen on this screen (`people/employees`), each with its
 * department, opening on Knowledge Hub · SOPs. Nothing at all when there are none.
 */
export function Procedures({ screen }: { screen: string }) {
  const { navigate } = useRouter();
  const list = useInfinite("GET /api/v1/knowledge/sops/for-screen", { filters: { screen_key: screen } });
  if (!list.rows.length) return null;
  return (
    <section className="mt-6">
      <h3 data-ui="title" className="mb-2 text-lg font-strong text-foreground">
        Procedures
      </h3>
      <TapList
        label="Procedures"
        items={list.rows.map((r) => ({
          key: r.sop_id,
          title: r.title,
          sub: r.department_name,
          end: r.version ? <Pill>{`Version ${r.version}`}</Pill> : null,
          onSelect: () => navigate(hrefFor("knowledge", "sops", { id: r.sop_id })),
        }))}
      />
    </section>
  );
}
