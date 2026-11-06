import type { PublicJobCard } from "@mycity/contract/contract.gen.ts";
import { Button, EmptyState, ErrorState, Icon, Pager, SearchInput, Skeleton, SkylineHero } from "@mycity/ui";
import { usePaged } from "@/api/hooks";
import { Link } from "@/lib/router";
import { Page } from "@/shell/Page";
import { factsOf } from "./shared";

/** More roles than this and a search box shows above them (guide §10.1). */
const SEARCH_FROM = 8;

/**
 * Careers (#80): what a stranger sees at go.mycityapp.io/jobs. Indexable, open roles only, in the
 * server's pages of 25. The page opens on Lagos's skyline as it is lit at this hour; each role is a
 * card whose whole face opens it.
 */
export function Careers() {
  const list = usePaged("GET /api/public/v1/jobs");
  const searching = !!list.q.trim();
  const showSearch = searching || (list.page?.total ?? 0) > SEARCH_FROM;
  return (
    <Page title="Careers" index layout="open">
      <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city.">
        {showSearch && <SearchInput label="Search Roles" placeholder="Role or City" value={list.q} onChange={list.setQ} className="max-w-md" />}
      </SkylineHero>
      <section aria-labelledby="open-roles" className="mt-10 phone:mt-6 phone:px-4">
        <h2 id="open-roles" className="mb-5 animate-enter font-heading text-2xl enter-delay-3">
          Open Roles
        </h2>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.page ? (
          <ul aria-busy="true" className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li key={i} className="rounded-card border border-border bg-card p-5">
                <Skeleton lines={3} />
              </li>
            ))}
          </ul>
        ) : list.rows.length === 0 ? (
          searching ? (
            <EmptyState illustration="Search" title="No Matching Roles" text="Try a shorter word" action={<Button onClick={() => list.setQ("")}>Clear Search</Button>} />
          ) : (
            <EmptyState icon="brief" title="No Open Roles" text="New roles are posted here first" />
          )
        ) : (
          <ul className="enter-stagger enter-after-head grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
            {list.rows.map((r) => (
              <RoleCard key={r.slug} role={r} />
            ))}
          </ul>
        )}
        <Pager page={list.page} onPage={list.setPage} noun="role" label="Open Roles" className="mt-5" />
      </section>
    </Page>
  );
}

/** One open role: its department, its title as the card's link, where and how it is worked. */
function RoleCard({ role }: { role: PublicJobCard }) {
  const facts = factsOf(role);
  return (
    <li className="group relative flex min-h-44 flex-col gap-2 overflow-hidden rounded-card border border-border bg-card p-5 shadow-1 transition duration-(--dur) ease-out before:absolute before:inset-x-0 before:top-0 before:h-1 before:origin-left before:scale-x-0 before:bg-primary before:transition-transform before:duration-300 focus-within:border-ring focus-within:before:scale-x-100 hover:-translate-y-1 hover:border-secondary hover:shadow-3 hover:before:scale-x-100 motion-reduce:hover:translate-y-0 phone:min-h-0 dark:hover:border-accent-foreground">
      {role.department && <p className="text-2xs font-strong tracking-wide text-eyebrow uppercase">{role.department}</p>}
      <h3 className="font-heading text-xl leading-snug">
        <Link to={`/jobs/${role.slug}`} className="stretch-link text-foreground no-underline outline-none">
          {role.title}
        </Link>
      </h3>
      {facts.length > 0 && (
        <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-muted-foreground">
          {facts.map((f) => (
            <li key={f.icon} className="inline-flex items-center gap-1.5">
              <Icon name={f.icon} className="text-subtle-foreground" />
              {f.text}
            </li>
          ))}
        </ul>
      )}
      <span aria-hidden="true" className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-strong text-accent-foreground">
        View Role
        <Icon name="right" className="transition-transform duration-(--dur) group-hover:translate-x-1" />
      </span>
    </li>
  );
}
