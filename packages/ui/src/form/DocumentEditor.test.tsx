import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { DocumentEditor, type DocumentEditorField } from "./DocumentEditor";
import { installEditorTestEnv } from "./test-env";

beforeAll(installEditorTestEnv);

const FIELDS: DocumentEditorField[] = [
  { field: "partner.name", label: "Business Name", tag: "{{ partner.name }}", group: "Partner" },
  { field: "deal.valid_until", label: "Valid Until", tag: "{{ longdate deal.valid_until }}", group: "Deal" },
  { field: "ask.opening_hours", label: "Opening Hours", tag: "{{ ask.opening_hours }}", group: "Ask" },
];

const CHIP = '<span data-field="partner.name" data-label="Business Name">{{ partner.name }}</span>';

/** The editor is lazy (F22), so every test waits for its chunk. */
const open = async () => {
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Wording" })).toBeInTheDocument());
};

describe("DocumentEditor", () => {
  it("holds the space, then draws a named multi-line textbox", async () => {
    const { container } = render(<DocumentEditor label="Wording" fields={FIELDS} value="" onChange={vi.fn()} />);
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
    await open();
    expect(screen.getByRole("textbox", { name: "Wording" })).toHaveAttribute("aria-multiline", "true");
  });

  it("offers headings, lists, a table and the fields, each mark saying whether it is on", async () => {
    render(<DocumentEditor label="Wording" fields={FIELDS} value="" onChange={vi.fn()} />);
    await open();
    expect(screen.getByRole("group", { name: "Wording formatting" })).toBeInTheDocument();
    for (const name of ["Bold", "Italic", "Heading", "Bulleted List", "Numbered List"])
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Insert Table" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Insert Field" })).toBeInTheDocument();
  });

  it("draws a saved field as one chip that reads by its label", async () => {
    render(<DocumentEditor label="Wording" fields={FIELDS} value={`<p>Business Name: ${CHIP}</p>`} onChange={vi.fn()} />);
    await open();
    const chip = await screen.findByText("Business Name", { selector: ".rte-chip" });
    expect(chip).toHaveAttribute("data-field", "partner.name");
    expect(screen.queryByText("{{ partner.name }}")).toBeNull();
  });

  it("inserts a chosen field as a chip and hands back the tag the wording keeps", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DocumentEditor label="Wording" fields={FIELDS} value="<p>Ends </p>" onChange={onChange} />);
    await open();
    await user.click(screen.getByRole("textbox", { name: "Wording" }));
    await user.click(screen.getByRole("combobox", { name: "Insert Field" }));
    await user.click(await screen.findByRole("option", { name: "Deal: Valid Until" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)![0] as string;
    expect(html).toContain('data-field="deal.valid_until"');
    expect(html).toContain('data-label="Valid Until"');
    expect(html).toContain("{{ longdate deal.valid_until }}");
    expect(await screen.findByText("Valid Until", { selector: ".rte-chip" })).toBeInTheDocument();
  });

  it("narrows the fields as the person types", async () => {
    const user = userEvent.setup();
    render(<DocumentEditor label="Wording" fields={FIELDS} value="" onChange={vi.fn()} />);
    await open();
    await user.click(screen.getByRole("combobox", { name: "Insert Field" }));
    await user.type(await screen.findByRole("searchbox"), "hours");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ask: Opening Hours"]);
  });

  it("inserts a table with a header row, and offers its rows and columns only while the caret is in it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DocumentEditor label="Wording" fields={FIELDS} value="<p>Financials</p>" onChange={onChange} />);
    await open();
    expect(screen.queryByRole("button", { name: "Add Row" })).toBeNull();
    await user.click(screen.getByRole("textbox", { name: "Wording" }));
    await user.click(screen.getByRole("button", { name: "Insert Table" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0]).toContain("<table"));
    const html = onChange.mock.calls.at(-1)![0] as string;
    expect(html).toContain("<th");
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(await screen.findByRole("button", { name: "Add Row" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Row" }));
    await waitFor(() => expect((onChange.mock.calls.at(-1)![0] as string).match(/<tr/g)).toHaveLength(4));
    await user.click(screen.getByRole("button", { name: "Delete Table" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0]).not.toContain("<table"));
  });

  it("keeps a table of the server's HTML", async () => {
    render(
      <DocumentEditor
        label="Wording"
        fields={FIELDS}
        value="<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Fee</td><td>10</td></tr></table>"
        onChange={vi.fn()}
      />,
    );
    await open();
    expect(await screen.findByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Fee" })).toBeInTheDocument();
  });

  it.each([
    ["editing", false],
    ["read only", true],
  ])("marks the wording as content while %s, so a table in it is the document's and not a list", async (_state, readOnly) => {
    render(
      <DocumentEditor
        label="Wording"
        fields={FIELDS}
        readOnly={readOnly}
        value="<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Fee</td><td>10</td></tr></table>"
        onChange={vi.fn()}
      />,
    );
    await open();
    const table = (await screen.findByRole("columnheader", { name: "Amount" })).closest("table")!;
    expect(screen.getByRole("textbox", { name: "Wording" })).toHaveAttribute("data-copy", "content");
    expect(table.closest("[data-copy=content]")).not.toBeNull();
  });

  it("read only shows the wording with no toolbar", async () => {
    render(<DocumentEditor label="Wording" fields={FIELDS} readOnly value={`<p>${CHIP}</p>`} onChange={vi.fn()} />);
    await open();
    expect(screen.queryByRole("group", { name: "Wording formatting" })).toBeNull();
    expect(await screen.findByText("Business Name", { selector: ".rte-chip" })).toBeInTheDocument();
  });

  it("is named by its Field's label", async () => {
    render(
      <Field label="Agreement Wording">
        <DocumentEditor label="Agreement Wording" fields={FIELDS} value="" onChange={vi.fn()} />
      </Field>,
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Agreement Wording" })).toBeInTheDocument());
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<DocumentEditor label="Wording" fields={FIELDS} value={`<p>Business Name: ${CHIP}</p>`} onChange={vi.fn()} />);
    await open();
    expect(await axe(container)).toHaveNoViolations();
  });
});
