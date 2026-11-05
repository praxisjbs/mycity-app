import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { StepBar } from "../form/StepBar";
import { Brand } from "./Brand";
import { SkylineHero } from "./SkylineHero";
import { PageMessage, PublicPage } from "./PublicPage";

const links = (
  <>
    <a href="#/PublicPage" className="hover:text-foreground">
      Careers
    </a>
    <a href="#/PublicPage" className="hover:text-foreground">
      Verify a Document
    </a>
  </>
);

export default {
  component: "PublicPage",
  states: {
    Page: () => (
      <PublicPage landmarks={false} brand={<a href="#/PublicPage" aria-label="MyCityApp careers"><Brand name="MyCityApp" /></a>} links={links}>
        <h2 data-ui="title" className="text-xl font-strong">
          Open Roles
        </h2>
      </PublicPage>
    ),
    "Open Page": () => (
      <PublicPage layout="open" landmarks={false} brand={<a href="#/PublicPage" aria-label="MyCityApp careers"><Brand name="MyCityApp" /></a>} links={links}>
        <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." still />
      </PublicPage>
    ),
    "Page With Pane": () => (
      <PublicPage
        landmarks={false}
        brand={<a href="#/PublicPage" aria-label="MyCityApp careers"><Brand name="MyCityApp" /></a>}
        links={links}
        pane={
          <SkylineHero
            size="pane"
            record
            eyebrow="Your Application"
            title="Partnerships Associate"
            text="This link is yours until 12/11/2026, 18:00."
            wide={<StepBar steps={["About You", "CV and Questions", "Why This Role"]} at={0} vertical decorative />}
            still
          />
        }
      >
        <h2 data-ui="title" className="text-xl font-strong">
          Contact Details
        </h2>
      </PublicPage>
    ),
    "Message Sent": () => (
      <PageMessage icon="ok" tone="ok" title="Application Sent" action={<Button>See Other Roles</Button>}>
        We reply within five working days.
      </PageMessage>
    ),
    "Message Expired": () => (
      <PageMessage icon="clock" tone="warn" title="Offer Expired">
        Ask People for a new link.
      </PageMessage>
    ),
    "Message Not Found": () => <PageMessage title="Nothing at This Address" action={<Button variant="primary">See Open Roles</Button>} />,
  },
} satisfies GalleryEntry;
