import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Icon } from "../icons/Icon";
import { PageMessage } from "../shell/PublicPage";
import { Panel } from "./Panel";

export default {
  component: "Panel",
  states: {
    "A Step": () => (
      <Panel
        eyebrow="Step 1 of 3"
        progress={{ value: 1, max: 3 }}
        title="Contact Details"
        foot={
          <Button variant="solid" size="lg">
            Next
          </Button>
        }
      >
        <p className="text-md text-muted-foreground">Full Name, Email, Phone and Years of Experience.</p>
      </Panel>
    ),
    "With a Status": () => (
      <Panel
        eyebrow="Question 2 of 3"
        status={
          <span className="ps-saved">
            <Icon name="ok" />
            Saved
          </span>
        }
        progress={{ value: 2, max: 3 }}
        foot={
          <>
            <Button variant="line" size="lg">
              Back
            </Button>
            <Button variant="solid" size="lg">
              Next
            </Button>
          </>
        }
      >
        <p data-copy="content" className="text-xl font-strong">
          The same chain says the price is too high after one month of weak results. How do you keep the account?
        </p>
      </Panel>
    ),
    "An Outcome": () => (
      <Panel bare>
        <PageMessage icon="ok" tone="ok" title="Application Sent" reference={{ label: "Your Reference", value: "APP-0042" }} action={<Button variant="primary" size="lg">See Other Roles</Button>}>
          We emailed a copy to ngozi.okafor@example.com.
        </PageMessage>
      </Panel>
    ),
  },
} satisfies GalleryEntry;
