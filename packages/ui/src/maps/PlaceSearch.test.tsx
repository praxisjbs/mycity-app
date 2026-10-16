import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { PlaceSearch } from "./PlaceSearch";
import type { Place } from "./geoapify";

const PLACES: Place[] = [
  { place_id: "p1", formatted: "12 Admiralty Way, Lekki, Lagos", lat: 6.4321, lon: 3.4219 },
  { place_id: "p2", formatted: "4 Admiralty Road, Lekki, Lagos", lat: 6.4338, lon: 3.4255 },
];

describe("PlaceSearch", () => {
  it("waits for enough letters before asking the server", async () => {
    const search = vi.fn().mockResolvedValue(PLACES);
    render(<PlaceSearch search={search} onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox"), "ad");
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  it("finds addresses and offers them as real options", async () => {
    const search = vi.fn().mockResolvedValue(PLACES);
    render(<PlaceSearch search={search} onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox"), "admiralty");
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Search address" })).toBeInTheDocument());
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("12 Admiralty Way, Lekki, Lagos")).toHaveAttribute("data-copy", "content");
  });

  it("hands back the address with its coordinates and clears the box", async () => {
    const onPick = vi.fn();
    render(<PlaceSearch search={() => Promise.resolve(PLACES)} onPick={onPick} />);
    await userEvent.type(screen.getByRole("searchbox"), "admiralty");
    await userEvent.click(await screen.findByRole("option", { name: /12 Admiralty Way/ }));
    expect(onPick).toHaveBeenCalledWith(PLACES[0]);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows the address already chosen above the box", () => {
    render(<PlaceSearch search={vi.fn()} onPick={vi.fn()} value={PLACES[0]} />);
    expect(screen.getByText("12 Admiralty Way, Lekki, Lagos")).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    render(<PlaceSearch search={() => Promise.resolve([])} onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox"), "nowhere at all");
    expect(await screen.findByText("No address matches")).toBeInTheDocument();
  });

  it("says in words when the lookup fails", async () => {
    render(<PlaceSearch search={() => Promise.reject(new Error("no"))} onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox"), "admiralty");
    expect(await screen.findByText("Could not search addresses")).toBeInTheDocument();
  });

  it("drops an answer to a search the person has typed past", async () => {
    const search = vi.fn((q: string) =>
      q === "admiralty"
        ? new Promise<Place[]>((r) => setTimeout(() => r(PLACES), 300))
        : Promise.resolve([{ place_id: "p9", formatted: "Ikeja Depot, Lagos", lat: 6.6, lon: 3.35 }]),
    );
    render(<PlaceSearch search={search} onPick={vi.fn()} />);
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "admiralty");
    await userEvent.clear(box);
    await userEvent.type(box, "ikeja");
    await waitFor(() => expect(screen.getByText("Ikeja Depot, Lagos")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText("12 Admiralty Way, Lekki, Lagos")).toBeNull();
  });

  it("gives every result a 44 px target on a phone", async () => {
    render(<PlaceSearch search={() => Promise.resolve(PLACES)} onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox"), "admiralty");
    const options = await screen.findAllByRole("option");
    options.forEach((o) => expect(o.className).toContain("phone:min-h-tap"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PlaceSearch search={() => Promise.resolve(PLACES)} onPick={vi.fn()} value={PLACES[1]} />);
    await userEvent.type(screen.getByRole("searchbox"), "admiralty");
    await screen.findAllByRole("option");
    expect(await axe(container)).toHaveNoViolations();
  });
});
