// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { copyProblems, openAs, settled } from "./testKit";

/**
 * Document Centre · Categories on the in-browser mock (docs/guides/document-centre.md §6.4, §10):
 * the categories beside the picked one on a wide desktop and in a sheet on a phone (F31), who sees
 * each, New Category with its audience, and the tab kept to documents.manage.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

expect.extend(axeMatchers);
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
  setViewport(1440);
});

const HERE = "/documents?tab=categories";

describe("Document Centre · Categories", () => {
  it("lists the categories with who sees each and how many documents, the first beside the list", async () => {
    await openAs("cynthia@mycityapp.io", HERE);
    expect(screen.getByRole("heading", { name: "Categories", level: 1 })).toBeTruthy();
    for (const name of ["Registration & Statutory", "Licences & Permits", "Finance Records"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Management, Operations & People").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Edit Category" }).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("New Category takes a name and who sees it; Named Roles asks for the roles", async () => {
    await openAs("cynthia@mycityapp.io", HERE);
    fireEvent.click(screen.getAllByRole("button", { name: "New Category" })[0]!);
    const form = await screen.findByRole("dialog", { name: "New Category" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Board Papers" } });
    expect(within(form).queryByText("Roles")).toBeNull();
    fireEvent.click(within(form).getByText("Named Roles"));
    expect(await within(form).findByText("Roles")).toBeTruthy();
    fireEvent.click(within(form).getByText("Everyone"));
    fireEvent.click(within(form).getByRole("button", { name: "Create Category" }));
    await settled();
    expect(screen.queryByRole("dialog", { name: "New Category" })).toBeNull();
    expect(screen.getAllByText("Board Papers").length).toBeGreaterThan(0);
  }, 60000);

  it("on a phone the categories are cards and a tapped card opens its sheet", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", HERE);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click((await screen.findAllByText("Licences & Permits"))[0]!);
    await settled();
    const sheet = screen.getAllByRole("dialog").at(-1)!;
    expect(within(sheet).getByRole("button", { name: "Edit Category" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);
});
