import { beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Modal } from "../overlay/Modal";
import { installOverlayTestEnv } from "../overlay/test-env";
import type { Place, SearchPlaces } from "../maps/geoapify";
import { AddressField } from "./AddressField";
import { Field } from "./Field";

const PLACES: Place[] = [
  { place_id: "p1", formatted: "12 Admiralty Way, Lekki, Lagos", lat: 6.4321, lon: 3.4219 },
  { place_id: "p2", formatted: "4 Admiralty Road, Lekki, Lagos", lat: 6.4338, lon: 3.4255 },
];

function Harness({ search, onPick, initial = "" }: { search: SearchPlaces; onPick?: (p: Place) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Address">
      <AddressField value={value} onChange={setValue} search={search} onPick={onPick} placeholder="7 Admiralty Way" />
    </Field>
  );
}

beforeAll(installOverlayTestEnv);

describe("AddressField", () => {
  it("is a labelled combobox that keeps what was typed", async () => {
    render(<Harness search={() => Promise.resolve([])} />);
    const box = screen.getByRole("combobox", { name: "Address" });
    await userEvent.type(box, "No 3, Close");
    expect(box).toHaveValue("No 3, Close");
  });

  it("waits for three letters before asking the server", async () => {
    const search = vi.fn().mockResolvedValue(PLACES);
    render(<Harness search={search} />);
    await userEvent.type(screen.getByRole("combobox"), "ad");
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  it("offers the addresses found as real options", async () => {
    render(<Harness search={() => Promise.resolve(PLACES)} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Addresses" })).toBeInTheDocument());
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("12 Admiralty Way, Lekki, Lagos")).toHaveAttribute("data-copy", "content");
  });

  it("fills the address with the place picked and hands back its coordinates", async () => {
    const onPick = vi.fn();
    render(<Harness search={() => Promise.resolve(PLACES)} onPick={onPick} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await userEvent.click(await screen.findByRole("option", { name: /4 Admiralty Road/ }));
    expect(onPick).toHaveBeenCalledWith(PLACES[1]);
    expect(screen.getByRole("combobox")).toHaveValue("4 Admiralty Road, Lekki, Lagos");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves through the options with the arrows and picks with Enter", async () => {
    const onPick = vi.fn();
    render(<Harness search={() => Promise.resolve(PLACES)} onPick={onPick} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "admiralty");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /4 Admiralty Road/ })).toHaveAttribute("aria-selected", "true");
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /4 Admiralty Road/ }).id);
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(PLACES[1]);
    expect(box).toHaveValue("4 Admiralty Road, Lekki, Lagos");
  });

  it("closes the list on Esc and when the field is left", async () => {
    render(<Harness search={() => Promise.resolve(PLACES)} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(screen.getByRole("combobox"), " w");
    await screen.findByRole("listbox");
    await userEvent.tab();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not search an address it was given rather than typed", async () => {
    const search = vi.fn().mockResolvedValue(PLACES);
    render(<Harness search={search} initial="7 Admiralty Way, Lekki" />);
    await userEvent.click(screen.getByRole("combobox"));
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  it("says when nothing matches, and when the search fails", async () => {
    const { unmount } = render(<Harness search={() => Promise.resolve([])} />);
    await userEvent.type(screen.getByRole("combobox"), "nowhere at all");
    expect(await screen.findByText("No address matches")).toBeInTheDocument();
    unmount();
    render(<Harness search={() => Promise.reject(new Error("no"))} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    expect(await screen.findByText("Could not search addresses")).toBeInTheDocument();
  });

  it("has no accessibility violations, open or closed", async () => {
    const { container } = render(<Harness search={() => Promise.resolve(PLACES)} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await screen.findByRole("listbox");
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ["desktop", 1440],
    ["a phone", 390],
  ])("inside a modal on %s, Esc closes the list first and the modal only after", async (_, width) => {
    setViewport(width);
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add Worksite">
        <Harness search={() => Promise.resolve(PLACES)} />
      </Modal>,
    );
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
