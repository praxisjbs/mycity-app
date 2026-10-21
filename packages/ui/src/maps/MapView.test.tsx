import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { MapView, type MapMarker } from "./MapView";

const MARKERS: MapMarker[] = [
  { key: "in", lat: 6.4321, lon: 3.4219, label: "Clocked in 07:52", tone: "brand" },
  { key: "out", lat: 6.4388, lon: 3.4301, label: "Clocked out 17:04" },
];

/** The drawing is lazy (F22); jsdom has no layout, so Leaflet is asked for nothing beyond mounting. */
const drawn = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelector("[data-points]")).not.toBeNull());
  return container.querySelector<HTMLElement>("[data-points]")!;
};

describe("MapView", () => {
  it("holds the space, then draws the map", async () => {
    const { container } = render(<MapView markers={MARKERS} />);
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
    await drawn(container);
  });

  it("writes every point out as words, so the map is never the only way to read one", () => {
    render(<MapView markers={MARKERS} />);
    expect(screen.getByText("Clocked in 07:52: 6.43210, 3.42190")).toBeInTheDocument();
    expect(screen.getByText("Clocked out 17:04: 6.43880, 3.43010")).toBeInTheDocument();
  });

  it("hides the drawing itself from screen readers", async () => {
    const { container } = render(<MapView markers={MARKERS} />);
    expect(await drawn(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("takes the tiles from our own proxy unless a screen passes its own", async () => {
    const { container } = render(<MapView markers={MARKERS} />);
    await drawn(container);
    // The tile layer is Leaflet's; what matters here is that nothing points at a provider.
    expect(container.innerHTML).not.toContain("geoapify.com");
  });

  it("opens on the first point, or on Lagos when there is none", async () => {
    const { container } = render(<MapView />);
    const map = await drawn(container);
    expect(map.getAttribute("data-points")).toBe("");
  });

  it("carries what the screen puts under the map", () => {
    render(
      <MapView markers={MARKERS}>
        <span>12 Admiralty Way, Lekki</span>
      </MapView>,
    );
    expect(screen.getByText("12 Admiralty Way, Lekki")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <MapView markers={MARKERS} radiusMetres={150} onPick={vi.fn()} interactive>
        <span>12 Admiralty Way, Lekki</span>
      </MapView>,
    );
    await drawn(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("fetches every tile through the screen's own loader when given one, and draws the bytes", async () => {
    // jsdom has no layout; give the map a size so Leaflet asks for the tiles in view.
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(256);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(256);
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tile");
    const loadTile = vi.fn().mockResolvedValue(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    try {
      const { container } = render(<MapView markers={MARKERS} loadTile={loadTile} />);
      await drawn(container);
      await waitFor(() => expect(loadTile).toHaveBeenCalled());
      expect(loadTile.mock.calls[0]![0]).toMatch(/^\/api\/v1\/maps\/tiles\/15\/\d+\/\d+\.png$/);
      await waitFor(() => expect(container.querySelector('img[src="blob:tile"]')).not.toBeNull());
    } finally {
      width.mockRestore();
      height.mockRestore();
      made.mockRestore();
    }
  });
});
