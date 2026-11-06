import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, formatDate, PageIntro, Pager, Reveal, RoleListTop, RoleRow, SiteSearch, Skeleton, StickyColumns, TeamList } from "@mycity/ui";
import { useApi, usePaged } from "@/api/hooks";
import { Link, useSearchParam } from "@/lib/router";
import { Page } from "@/shell/Page";
import { factsOf, rolesLine } from "./shared";

/**
 * Careers (#80): every open role at go.mycityapp.io/jobs, indexable, closing soonest first in the
 * server's pages of 25. Open Roles with its line and search; the teams hiring at the left, one picked
 * at a time (the server narrows by `department`), the roles at the right; both columns stick, the
 * shorter waiting. `?q=` (the index's Search Roles) and `?department=<code>` open it narrowed.
 */
export function Careers() {
  const startQ = useSearchParam("q");
  const startTeam = useSearchParam("department");
  const [team, setTeam] = useState(startTeam ?? "");
  const summary = useApi("GET /api/public/v1/jobs/summary");
  const list = usePaged("GET /api/public/v1/jobs", { filters: team ? { department: team } : {} });
  const searching = !!list.q.trim();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (startQ) list.setQ(startQ);
  }, [startQ, list]);

  const s = summary.data;
  const total = s?.open ?? list.page?.total ?? 0;
  const teams = [{ value: "", label: "All Teams", count: s?.open ?? 0 }, ...(s?.departments ?? []).map((d) => ({ value: d.code, label: d.name, count: d.open }))];
  const clear = () => {
    list.setQ("");
    setTeam("");
  };

  return (
    <Page title="Careers" index>
      <PageIntro
        eyebrow="Careers at MyCityApp"
        title="Open Roles"
        accent="Roles"
        text={s ? rolesLine(s.open, s.departments.length, s.cities.map((c) => c.name)) : undefined}
        aside={
          <SiteSearch
            tone="intro"
            label="Search Roles"
            placeholder="Role or City"
            value={list.q}
            onChange={(v) => {
              list.setQ(v);
              setTeam("");
            }}
          />
        }
      />
      <section id="roles" aria-labelledby="roles-title" className="pt-9 pb-24 phone:pb-18">
        <div className="public-wrap">
          <StickyColumns layout="aside">
            <Reveal as="aside" scroll>
              <TeamList
                title="Teams"
                titleId="roles-title"
                label="Teams"
                items={teams}
                value={team}
                onChange={setTeam}
                note={
                  <>
                    Know someone for one of these? <Link to="/#refer">Recommend them</Link>
                  </>
                }
              />
            </Reveal>
            <div>
              <RoleListTop shown={list.page?.total ?? 0} total={total} order="Closing soonest first" />
              {list.error ? (
                <ErrorState error={list.error} onRetry={list.reload} />
              ) : list.loading && !list.page ? (
                <div aria-busy="true" className="flex flex-col gap-6 py-6">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} lines={3} />
                  ))}
                </div>
              ) : list.rows.length === 0 ? (
                searching || team ? (
                  <EmptyState illustration="Search" title="No Matching Roles" text="Try a shorter word" action={<Button variant="line" size="lg" onClick={clear}>Clear Search</Button>} />
                ) : (
                  <EmptyState icon="brief" title="No Open Roles" text="New roles are posted here first" />
                )
              ) : (
                <div>
                  {list.rows.map((r) => (
                    <RoleRow key={r.slug} href={`/jobs/${r.slug}`} team={r.department} title={r.title} facts={factsOf(r)} closes={r.closes_at ? formatDate(r.closes_at) : null} />
                  ))}
                </div>
              )}
              <Pager page={list.page} onPage={list.setPage} noun="role" label="Open Roles" className="mt-5" />
            </div>
          </StickyColumns>
        </div>
      </section>
    </Page>
  );
}
