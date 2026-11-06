import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { DocumentEditor, type DocumentEditorField } from "./DocumentEditor";

const FIELDS: DocumentEditorField[] = [
  { field: "today", label: "Date", tag: "{{ longdate today }}", group: "Agreement" },
  { field: "partner.name", label: "Business Name", tag: "{{ partner.name }}", group: "Partner" },
  { field: "contact.full_name", label: "Contact Person", tag: "{{ contact.full_name }}", group: "Contact" },
  { field: "deal.title", label: "Deal Title", tag: "{{ deal.title }}", group: "Deal" },
  { field: "deal.valid_until", label: "Valid Until", tag: "{{ longdate deal.valid_until }}", group: "Deal" },
  { field: "deal.options", label: "Deal Options", tag: "{{ deal.options }}", group: "Deal" },
  { field: "ask.opening_hours", label: "Opening Hours", tag: "{{ ask.opening_hours }}", group: "Ask" },
];

const chip = (field: string) => {
  const f = FIELDS.find((x) => x.field === field)!;
  return `<span data-field="${f.field}" data-label="${f.label}">${f.tag}</span>`;
};

const AGREEMENT = [
  "<h2>Deal Merchant Agreement</h2>",
  `<p>Date: ${chip("today")}</p>`,
  `<p>Business Name: ${chip("partner.name")}</p>`,
  `<p>Contact person: ${chip("contact.full_name")}</p>`,
  "<h3>Financials</h3>",
  `<p>${chip("deal.options")}</p>`,
  "<h3>Fine Print and Highlights</h3>",
  "<ol><li>Event registration and check-in on MyCityApp, with our team supporting the setup.</li><li>Amplification across MyCity's channels.</li></ol>",
  `<p>Opening hours: ${chip("ask.opening_hours")}</p>`,
].join("");

const Writing = () => {
  const [body, setBody] = useState(AGREEMENT);
  return (
    <Field label="Agreement Wording">
      <DocumentEditor label="Agreement Wording" fields={FIELDS} value={body} onChange={setBody} />
    </Field>
  );
};

export default {
  component: "DocumentEditor",
  states: {
    Writing,
    Empty: () => <DocumentEditor label="Agreement Wording" fields={FIELDS} value="" onChange={() => undefined} placeholder="Start Writing" />,
    "With A Table": () => (
      <DocumentEditor
        label="Agreement Wording"
        fields={FIELDS}
        value="<h3>Charges</h3><table><tr><th>Item</th><th>Amount</th></tr><tr><td>Listing</td><td>₦50,000.00</td></tr><tr><td>Check-in</td><td>₦25,000.00</td></tr></table>"
        onChange={() => undefined}
      />
    ),
    "Already Signed": () => <DocumentEditor label="Agreement Wording" fields={FIELDS} readOnly value={AGREEMENT} onChange={() => undefined} />,
    "With An Error": () => (
      <Field label="Agreement Wording" state="bad" message="Write the agreement">
        <DocumentEditor label="Agreement Wording" fields={FIELDS} value="" onChange={() => undefined} />
      </Field>
    ),
  },
} satisfies GalleryEntry;
