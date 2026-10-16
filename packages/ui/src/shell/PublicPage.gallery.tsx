import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Brand } from "./Brand";
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
