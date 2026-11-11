import { useState, type ReactNode } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { SiteSearch } from "../form/SiteSearch";
import { Form } from "../form/Form";
import { TextField } from "../form/TextField";
import { PageIntro } from "../layout/PageIntro";
import { Panel } from "../layout/Panel";
import { VerifyCard } from "../display/VerifyCard";
import { SkylineHero } from "./SkylineHero";
import { PageMessage, PublicPage, type PublicNavItem } from "./PublicPage";

const nav = (current: string): PublicNavItem[] =>
  [
    { label: "Vacancy", href: "#/PublicPage" },
    { label: "Apply", href: "#/PublicPage?apply" },
    { label: "Verify Document", href: "#/PublicPage?verify" },
  ].map((n) => ({ ...n, current: n.label === current }));

/** The right column's card, as a split page puts its work on one: a Panel. */
const card = (title: string, body: ReactNode, action?: string) => (
  <Panel
    title={title}
    foot={
      action ? (
        <Button variant="solid" size="lg">
          {action}
        </Button>
      ) : undefined
    }
  >
    {body}
  </Panel>
);

const LETTER = [
  "We are pleased to offer you the position of Content Producer at MyCity App Ltd, reporting to the Head of Content.",
  "Your gross monthly salary will be paid at the end of each month, after a probation of three months.",
  "Working hours are 09:00 to 17:00 Monday to Friday, and 09:00 to 15:00 on Saturday.",
  "This offer is conditional upon satisfactory documentation, which we list once you sign.",
  "We look forward to working with you.",
];

/** Verify a Document's aside: the reference and its button. */
function ReferenceForm() {
  const [ref, setRef] = useState("");
  return (
    <Form onSubmit={() => undefined} className="flex gap-2.5 phone:flex-col">
      <TextField aria-label="Reference" placeholder="OFF-0018" value={ref} onChange={setRef} />
      <Button variant="solid" size="lg" type="submit">
        Verify Document
      </Button>
    </Form>
  );
}

export default {
  component: "PublicPage",
  states: {
    "The Index": () => (
      <PublicPage layout="full" landmarks={false} nav={nav("Vacancy")} brandSub="Careers">
        <SkylineHero size="index" eyebrow="Hiring in Lagos and Abuja" title="Work With Us" accent="Us" text="Building the app that knows every Nigerian city." stats={[{ value: 12, label: "Open Roles" }]} still>
          <SiteSearch label="Search Roles" placeholder="Role or City" value="" onChange={() => undefined} onSubmit={() => undefined} />
        </SkylineHero>
      </PublicPage>
    ),
    "Inner Page": () => (
      <PublicPage layout="full" landmarks={false} nav={nav("Vacancy")} brandSub="Careers">
        <PageIntro eyebrow="Careers at MyCityApp" title="Open Roles" accent="Roles" text="12 roles across 7 teams, in Lagos and Abuja." />
      </PublicPage>
    ),
    "Split: Apply": () => (
      <PublicPage
        layout="split"
        landmarks={false}
        nav={nav("Apply")}
        brandSub="Careers"
        name="Head, Sales & Revenue"
        line="Marketing & Sales, Lekki Phase 1, Lagos"
        title="Apply"
        text="Your application, in three steps."
        paragraph="Your CV, a few questions and why this role. This link works until 08/11/2026."
        steps={{ items: ["About You", "CV and Questions", "Why This Role"], at: 1 }}
      >
        {card("CV and Questions", <p className="mt-4 text-lg text-muted-foreground">Choose your CV, then answer two questions.</p>, "Next Step")}
      </PublicPage>
    ),
    "Split: Sign Offer": () => (
      <PublicPage
        layout="split"
        landmarks={false}
        nav={nav("Apply")}
        brandSub="Careers"
        name="Content Producer"
        line="Offer of Employment, OFF-0018"
        title="Offer of Employment"
        text="Your offer, ready to sign."
        paragraph="For Chiamaka Eze, from MyCity App Ltd. It expires on 13/11/2026."
        steps={{ items: ["Read the Letter", "Sign Below"], at: 0 }}
      >
        {card(
          "Offer of Employment",
          <div data-copy="content">
            {LETTER.map((l) => (
              <p key={l} className="mt-4 text-lg leading-relaxed">
                {l}
              </p>
            ))}
          </div>,
          "Accept and Sign",
        )}
      </PublicPage>
    ),
    "Split: Verify": () => (
      <PublicPage
        layout="split"
        landmarks={false}
        nav={nav("Verify Document")}
        brandSub="Careers"
        name="Document Check"
        line="Offer letters, certificates and agreements"
        title="Verify a Document"
        text="Check any document we issued."
        textSize="l"
        paragraph="Enter the reference printed on the document, for example OFF-0018, or scan the QR code on any of its pages."
        aside={<ReferenceForm />}
      >
        <VerifyCard empty={{ title: "Enter a Reference", text: "The document's record shows here." }} />
      </PublicPage>
    ),
    "Message Sent": () => (
      <PageMessage icon="ok" tone="ok" title="Application Sent" reference={{ label: "Your Reference", value: "APP-0042" }} action={<Button variant="primary" size="lg">See Other Roles</Button>}>
        We emailed a copy to ngozi.okafor@example.com.
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
