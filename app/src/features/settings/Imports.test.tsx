// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ImportBatch } from "@mycity/contract/contract.gen.ts";
import { ApiError, ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";

/**
 * Settings · Imports, the wizard's Map step (docs/guides/foundation.md §10): the required fields
 * show before Next, and a mapping that leaves one without a column is refused in the window, named,
 * with focus on the refusal, until it is put right (QA OBS-03, 26/10/2026: it was a toast after the
 * window had moved on).
 */

const m = vi.hoisted(() => ({
  run: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  importers: [
    {
      key: "employees",
      label: "Employees",
      entity: "employee",
      permission: "people.create",
      match_keys: ["staff_number", "work_email"],
      fields: [
        { key: "full_name", label: "Name", type: "text", required: true, aliases: [], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: null, hint: null },
        { key: "job_title", label: "Designation", type: "text", required: true, aliases: [], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: null, hint: null },
        { key: "department", label: "Department", type: "reference", required: true, aliases: [], options: [], ref: "department", pass: 1, create_missing: true, masked: false, example: null, hint: null },
        { key: "work_email", label: "Work Email", type: "email", required: false, aliases: [], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: null, hint: null },
      ],
    },
  ],
}));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: { importers: m.importers }, error: null, reload: () => undefined, set: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
  usePaged: () => ({ rows: [], page: { number: 1, size: 25, total: 0, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined }),
}));

import { ImportWizard } from "./Imports";

/** An uploaded sheet of name, email and phone: Name and Work Email found, phone left out. */
const batch = (columns: ImportBatch["mapping"]["columns"]): ImportBatch =>
  ({
    import_batch_id: "b1",
    number: "IMP-0004",
    importer_key: "employees",
    importer_label: "Employees",
    document_id: "d1",
    file_name: "staff.csv",
    sheet: "Sheet1",
    header_row: 0,
    mapping: { columns },
    options: {},
    status: "mapped",
    stats: {},
    created_by_name: "Ngozi Umeh",
    created_at: "2026-10-26T09:00:00.000Z",
    previewed_at: null,
    committed_at: null,
    reverted_at: null,
  }) as unknown as ImportBatch;

const SHORT = batch([
  { index: 0, header: "name", field: "full_name" },
  { index: 1, header: "email", field: "work_email" },
  { index: 2, header: "phone", field: null },
]);

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = (resume: ImportBatch) =>
  render(
    <ModalProvider>
      <ImportWizard preferred={null} resume={resume} close={() => undefined} />
    </ModalProvider>,
  );

/** Chooses a field for one of the sheet's columns. */
function choose(column: string, field: string) {
  fireEvent.click(screen.getByRole("combobox", { name: column }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: field }));
}

describe("Settings · Imports, Map", () => {
  it("lists the required fields before Next", () => {
    open(SHORT);
    const required = screen.getByText("Required").closest("div")!;
    expect(within(required).getByText("Name")).toBeTruthy();
    expect(within(required).getByText("Designation")).toBeTruthy();
    expect(within(required).getByText("Department")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses Next in the window, naming every required field without a column, until each has one", async () => {
    open(SHORT);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("Choose a column for Designation and Department");
    await waitFor(() => expect(refusal.closest("[tabindex]")).toBe(document.activeElement));
    expect(m.run).not.toHaveBeenCalled();

    choose("phone", "Designation");
    expect(screen.getByRole("alert").textContent).toContain("Choose a column for Department");
    expect(screen.getByRole("heading", { name: /Map/ })).toBeTruthy();
  });

  it("shows the server's refusal of a mapping in the same place, and clears it once the mapping changes", async () => {
    m.run.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: "IMPORT_MAPPING_INVALID",
          message: '"email" and "work" are both mapped to Work Email',
          fields: { mapping: ['"email" and "work" are both mapped to Work Email'] },
        },
      }),
    );
    open(
      batch([
        { index: 0, header: "name", field: "full_name" },
        { index: 1, header: "role", field: "job_title" },
        { index: 2, header: "team", field: "department" },
        { index: 3, header: "email", field: "work_email" },
        { index: 4, header: "work", field: "work_email" },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain('"email" and "work" are both mapped to Work Email');
    expect(m.run).toHaveBeenCalledTimes(1);

    choose("work", "Leave Out");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves a field picked for a second column, so a field mapped twice never reaches the server (fault #2 on staging, 27/10/2026)", async () => {
    const sheet = batch([
      { index: 0, header: "name", field: "full_name" },
      { index: 1, header: "role", field: "job_title" },
      { index: 2, header: "team", field: "department" },
      { index: 3, header: "email", field: "work_email" },
      { index: 4, header: "work", field: null },
    ]);
    m.run.mockResolvedValueOnce(sheet).mockResolvedValueOnce({ batch: { ...sheet, status: "previewed" }, stats: {} });
    open(sheet);
    choose("work", "Work Email");
    expect(screen.getByRole("combobox", { name: "work" }).textContent).toContain("Work Email");
    expect(screen.getByRole("combobox", { name: "email" }).textContent).toContain("Leave Out");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(m.run).toHaveBeenCalled());
    const sent = m.run.mock.calls[0]![0] as { body: { fields: Record<string, string | null> } };
    expect(Object.values(sent.body.fields).filter((f) => f === "work_email")).toHaveLength(1);
    expect(sent.body.fields).toMatchObject({ "3": null, "4": "work_email" });
  });
});
