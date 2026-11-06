import { useState } from "react";
import { Button, CtaCard, CtaCards, FeatureGrid, formatDate, HireSteps, RichText, RoleTile, RoleTiles, SectionHead, SiteSearch, SkylineHero, type FeatureGridTile } from "@mycity/ui";
import { useApi } from "@/api/hooks";
import { siteUrl, useCopy } from "@/lib/copy";
import { Link, useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";
import { joinAnd } from "./shared";

/** What MyCityApp builds: the index's fixed words, as its hero's line is. */
const BUILD: FeatureGridTile[] = [
  { icon: "pin", title: "Discover Places", text: "Restaurants, experiences and the places worth knowing." },
  { icon: "calendar", title: "Find What's On", text: "Events and what is happening around you, as it happens." },
  { icon: "store", title: "Grow Businesses", text: "Merchants reach new customers and grow their visibility." },
  { icon: "landmark", title: "City Services", text: "Government services, closer to the people who use them." },
];

/** How every role is filled, in the order a candidate meets it. */
const HIRE = [
  { title: "Apply", text: "Your CV and a short cover letter, on one form." },
  { title: "Screening", text: "Our team reads every application against the role." },
  { title: "Assessment", text: "A short test or a practical brief, for some roles." },
  { title: "Interview", text: "Meet the panel in person, by video or by phone." },
];

/**
 * Home (`/`, the public index): Work With Us over Lagos's skyline with the search and the three figures
 * counting up, What We Build with About MyCityApp from Careers Settings, the three roles closing
 * soonest, How We Hire, and the two calls to action. Every figure and role comes from
 * `/jobs/summary`; the blocks rise into view as the page scrolls, through the shared components.
 */
export function Home() {
  const { navigate } = useRouter();
  const s = useApi("GET /api/public/v1/jobs/summary");
  const [q, setQ] = useState("");
  const { copied, copy } = useCopy();
  const d = s.data;
  const cities = d?.cities.map((c) => c.name) ?? [];
  const search = () => navigate(q.trim() ? `/jobs?q=${encodeURIComponent(q.trim())}` : "/jobs");

  return (
    <Page title="Work With Us" index>
      <SkylineHero
        size="index"
        eyebrow={cities.length ? `Hiring in ${joinAnd(cities)}` : undefined}
        title="Work With Us"
        accent="Us"
        text="Building the app that knows every Nigerian city."
        stats={
          d
            ? [
                { value: d.open, label: "Open Roles" },
                { value: d.departments.length, label: "Teams Hiring" },
                { value: d.cities.length, label: "Cities" },
              ]
            : undefined
        }
      >
        <SiteSearch tone="hero" label="Search Roles" placeholder="Role or City" action="Search Roles" value={q} onChange={setQ} onSubmit={search} />
      </SkylineHero>

      <section id="build" aria-labelledby="build-title" className="py-24 phone:py-18">
        <div className="public-wrap">
          <SectionHead kicker="What We Build" title="One App, Every City" text="Places, events, businesses and government services, in every Nigerian city." id="build-title" />
          <FeatureGrid
            feature={{
              title: "About MyCityApp",
              body: d?.about_company?.length ? <RichText look="site" blocks={d.about_company} top={4} /> : null,
              action: (
                <Button variant="primary" size="lg" asChild>
                  <a href="https://mycityapp.io">Visit MyCityApp</a>
                </Button>
              ),
            }}
            tiles={BUILD}
          />
        </div>
      </section>

      {d && d.closing_soon.length > 0 && (
        <section aria-labelledby="latest-title" className="pb-24 phone:pb-18">
          <div className="public-wrap">
            <SectionHead
              align="split"
              eyebrow="Careers"
              title="Closing Soon"
              accent="Soon"
              id="latest-title"
              action={
                <Button variant="line" size="lg" asChild>
                  <Link to="/jobs">See All Roles</Link>
                </Button>
              }
            />
            <RoleTiles label="Closing Soon" className="mt-12">
              {d.closing_soon.map((r) => (
                <RoleTile
                  key={r.slug}
                  href={`/jobs/${r.slug}`}
                  team={r.department}
                  title={r.title}
                  line={[r.location, r.closes_at ? `Closes ${formatDate(r.closes_at)}` : null].filter(Boolean).join(". ") + "."}
                />
              ))}
            </RoleTiles>
          </div>
        </section>
      )}

      <section id="hire" aria-labelledby="hire-title" className="pt-10 pb-24 phone:pb-18">
        <div className="public-wrap">
          <SectionHead kicker="How We Hire" title="Four Steps, Every Time" text="The same fair process for every role and every candidate." id="hire-title" />
          <HireSteps label="How We Hire" steps={HIRE} />
        </div>
      </section>

      <section aria-label="Recommend and verify" className="pb-24 phone:pb-18">
        <CtaCards className="public-wrap">
          <CtaCard
            tone="deep"
            from="left"
            id="refer"
            icon="userplus"
            title="Know Someone Great?"
            text="Send them our roles. Their application comes straight to our hiring team."
            action={
              <Button variant="primary" size="lg" onClick={() => copy("careers", siteUrl("/jobs"))}>
                {copied === "careers" ? "Link Copied" : "Copy Careers Link"}
              </Button>
            }
          />
          <CtaCard
            from="right"
            delay={120}
            icon="shieldok"
            title="Verify a Document"
            text="Check an offer letter or certificate MyCityApp issued, by its reference."
            action={
              <Button variant="line" size="lg" asChild>
                <Link to="/verify">Verify a Document</Link>
              </Button>
            }
          />
        </CtaCards>
      </section>
    </Page>
  );
}
