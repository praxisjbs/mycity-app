import { usePaged } from "@/api/hooks";
import "@/api/types/public";
import type { VacancyCard } from "@/api/types/public";
import { Page } from "@/shell/Page";
import { Brand, Button, PageMessage, Skeleton, TextField } from "@mycity/ui";
import { Sub } from "@/components/ui";
import { Link, useRouter } from "@/lib/router";

export const PATTERN: Record<VacancyCard["work_pattern"], string> = { on_site: "On site", hybrid: "Hybrid", remote: "Remote" };
/** "Content · Lagos · Hybrid", the demo's line under a role. Remote roles drop the city. */
export const roleLine = (v: VacancyCard) => [v.department, v.work_pattern === "remote" ? null : v.location.split(",")[0], PATTERN[v.work_pattern]].filter(Boolean).join(" · ");

/** Careers (#80): what a stranger sees at go.mycityapp.io/jobs. Indexable. Open roles only. */
export function Careers() {
  const { navigate } = useRouter();
  const list = usePaged("GET /api/public/v1/jobs");
  const searching = !!list.q.trim();
  return (
    <Page title="Careers" index brandInCard>
      <div className="mb-[22px] text-center">
        <Brand name="MyCityApp" size="l" />
        <h1 className="mt-3.5 text-[24px]">Work With Us</h1>
        <Sub className="mt-1.5">Building the app that knows every Nigerian city.</Sub>
      </div>
      {((list.page?.total ?? 0) > 8 || searching) && (
        <div className="mb-3">
          <TextField value={list.q} onChange={list.setQ} placeholder="Role or city" aria-label="Search roles" type="search" />
        </div>
      )}
      {list.error ? (
        <PageMessage title="The roles could not load" action={<Button onClick={list.reload}>Try Again</Button>}>{list.error.message}</PageMessage>
      ) : list.loading && !list.page ? (
        <Skeleton lines={5} />
      ) : list.rows.length === 0 ? (
        <PageMessage icon="brief" title={searching ? "No role matches that search" : "No open roles right now"}>
          {searching ? "Try a shorter word, or clear the search." : "New roles are posted here first. Check back soon."}
        </PageMessage>
      ) : (
        <ul className="m-0 list-none p-0">
          {list.rows.map((v) => (
            <li key={v.slug} className="mb-[9px] flex items-center gap-3 rounded-[10px] border border-border p-[13px]">
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${v.slug}`} className="text-[14px] font-[650] text-foreground no-underline hover:underline">
                  {v.title}
                </Link>
                <Sub>{roleLine(v)}</Sub>
              </div>
              <Button variant="primary" onClick={() => navigate(`/jobs/${v.slug}`)} aria-label={`View ${v.title}`}>
                View
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.page && list.page.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px] text-subtle-foreground">
          <span>
            Page {list.page.number} of {list.page.pages}
          </span>
          <span className="flex gap-2">
            <Button disabled={list.page.number <= 1} onClick={() => list.setPage(list.page!.number - 1)}>Previous</Button>
            <Button disabled={!list.page.has_next} onClick={() => list.setPage(list.page!.number + 1)}>Next</Button>
          </span>
        </div>
      )}
      <Sub className="mt-[18px] border-t border-border pt-3.5 text-center">New roles are posted here first. Every role is open to anyone who meets what it asks for.</Sub>
    </Page>
  );
}
