import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { Modal } from "../overlay/Modal";
import { installOverlayTestEnv } from "../overlay/test-env";
import { readSampleToken, SAMPLE_PLACES, sampleToken } from "../maps/fixtures";
import type { LatLon, Place, Places, PlaceValue } from "../maps/geoapify";
import { forgetPlaces } from "../maps/usePlaces";
import { AddressField } from "./AddressField";
import { Field } from "./Field";

// The map's drawing is Leaflet in its own chunk; here a button stands in for a tap on the map.
vi.mock("../maps/MapView", () => ({
  MapView: ({ onPick, children }: { onPick?: (p: LatLon) => void; children?: React.ReactNode }) => (
    <div>
      <button type="button" onClick={() => onPick?.({ lat: 6.5095, lon: 3.3711 })}>
        Tap The Map
      </button>
      {children}
    </div>
  ),
}));

const [ROAD, LANE] = SAMPLE_PLACES as [Place, Place];
const PIN: Place = { place_id: "pin", formatted: "7 Pinned Close, Yaba, Lagos", lat: 6.5095, lon: 3.3711, kind: "building", token: sampleToken({ source: "pin", formatted: "7 Pinned Close, Yaba, Lagos", lat: 6.5095, lon: 3.3711, kind: "building" }) };

const placesOf = (over: Partial<Places> = {}): Places => ({
  search: vi.fn().mockResolvedValue([ROAD, LANE]),
  pin: vi.fn().mockResolvedValue(PIN),
  read: readSampleToken,
  ...over,
});

const down = (status = 503) => Object.assign(new Error("Maps are not set up."), { status });

function Harness({ places, initial = null, optional, onPick, onValue }: { places: Places; initial?: PlaceValue | null; optional?: boolean; onPick?: (p: Place) => void; onValue?: (v: PlaceValue | null) => void }) {
  const [value, setValue] = useState<PlaceValue | null>(initial);
  return (
    <Field label="Address" optional={optional}>
      <AddressField
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        places={places}
        onPick={onPick}
      />
    </Field>
  );
}

beforeAll(installOverlayTestEnv);
beforeEach(forgetPlaces);
afterEach(() => vi.unstubAllGlobals());

describe("AddressField", () => {
  it("searches what is typed and never takes it as the address", async () => {
    const onValue = vi.fn();
    const places = placesOf();
    render(<Harness places={places} onValue={onValue} />);
    const box = screen.getByRole("combobox", { name: "Address" });
    await userEvent.type(box, "Admiralty");
    expect(await screen.findByRole("listbox", { name: "Addresses" })).toBeInTheDocument();
    expect(box).toHaveValue("Admiralty");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("asks from the second letter, at the field's level, within a tenth of a second", async () => {
    const places = placesOf();
    render(<Harness places={places} />);
    await userEvent.type(screen.getByRole("combobox"), "a");
    await new Promise((r) => setTimeout(r, 200));
    expect(places.search).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("combobox"), "d");
    await waitFor(() => expect(places.search).toHaveBeenCalledWith("ad", expect.objectContaining({ level: "address" })), { timeout: 250 });
  });

  it("answers a text asked before at once, with no second request", async () => {
    const places = placesOf();
    render(<Harness places={places} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "Admiralty");
    await screen.findByRole("listbox");
    await userEvent.clear(box);
    await userEvent.type(box, "admiralty");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(places.search).toHaveBeenCalledTimes(1);
  });

  it("shows at once the places held for a shorter text that still match every word", async () => {
    const search = vi.fn((q: string) => (q === "admiralty" ? Promise.resolve([ROAD, LANE]) : new Promise<Place[]>(() => undefined)));
    render(<Harness places={placesOf({ search })} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "admiralty");
    await screen.findByRole("listbox");
    await userEvent.type(box, " way");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([ROAD.formatted]);
  });

  it("drops the answer to a text already typed past", async () => {
    const search = vi.fn((q: string, _opts?: { signal?: AbortSignal }) =>
      q === "admiralty" ? new Promise<Place[]>((r) => setTimeout(() => r([ROAD]), 300)) : Promise.resolve([LANE]),
    );
    render(<Harness places={placesOf({ search })} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "admiralty");
    await new Promise((r) => setTimeout(r, 150));
    await userEvent.clear(box);
    await userEvent.type(box, "road");
    await screen.findByRole("option", { name: new RegExp(LANE.formatted) });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("option", { name: new RegExp(ROAD.formatted) })).toBeNull();
    expect(search.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("picks with a press: the token goes to the form, the point to onPick, and the field shows it with Change", async () => {
    const onValue = vi.fn();
    const onPick = vi.fn();
    render(<Harness places={placesOf()} onValue={onValue} onPick={onPick} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await userEvent.click(await screen.findByRole("option", { name: new RegExp(LANE.formatted) }));
    expect(onValue).toHaveBeenLastCalledWith({ token: LANE.token, details: null });
    expect(onPick).toHaveBeenCalledWith(LANE);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(LANE.formatted)).toHaveAttribute("data-copy", "content");
    expect(screen.getByRole("button", { name: "Address Change" })).toHaveFocus();
  });

  it("moves with the arrows and picks with Enter; Enter on typed text never submits the form", async () => {
    const submit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onValue = vi.fn();
    render(
      <form onSubmit={submit}>
        <Harness places={placesOf()} onValue={onValue} />
      </form>,
    );
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "admiralty");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Enter}");
    expect(submit).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const second = screen.getByRole("option", { name: new RegExp(LANE.formatted) });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(box.getAttribute("aria-activedescendant")).toBe(second.id);
    await userEvent.keyboard("{Enter}");
    expect(onValue).toHaveBeenLastCalledWith({ token: LANE.token, details: null });
    expect(submit).not.toHaveBeenCalled();
  });

  it("takes Details under the address, at most 120 characters, and keeps them with a new pick", async () => {
    const onValue = vi.fn();
    render(<Harness places={placesOf()} initial={{ token: ROAD.token }} onValue={onValue} />);
    const details = screen.getByRole("textbox", { name: /Details/ });
    expect(details).toHaveAttribute("maxlength", "120");
    await userEvent.type(details, "Flat 3");
    expect(onValue).toHaveBeenLastCalledWith({ token: ROAD.token, details: "Flat 3" });
    await userEvent.click(screen.getByRole("button", { name: "Address Change" }));
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await userEvent.click(await screen.findByRole("option", { name: new RegExp(LANE.formatted) }));
    expect(onValue).toHaveBeenLastCalledWith({ token: LANE.token, details: "Flat 3" });
  });

  it("goes back to the address it held on Keep Address, Esc, or leaving with nothing picked", async () => {
    const onValue = vi.fn();
    render(<Harness places={placesOf()} initial={{ token: ROAD.token }} onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: "Address Change" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep Address" }));
    expect(screen.getByText(ROAD.formatted)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Address Change" }));
    await userEvent.type(screen.getByRole("combobox"), "somewhere");
    await userEvent.keyboard("{Escape}{Escape}");
    expect(screen.getByText(ROAD.formatted)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Address Change" }));
    await userEvent.type(screen.getByRole("combobox"), "typed and left");
    await userEvent.click(document.body);
    expect(screen.getByText(ROAD.formatted)).toBeInTheDocument();
    expect(onValue).not.toHaveBeenCalled();
  });

  it("drops typed text that was never picked when the field is left", async () => {
    render(<Harness places={placesOf({ search: vi.fn().mockResolvedValue([]) })} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "12 My Street");
    await userEvent.click(document.body);
    expect(box).toHaveValue("");
  });

  it("offers Clear Address only where the field is optional", async () => {
    const onValue = vi.fn();
    const { unmount } = render(<Harness places={placesOf()} initial={{ token: ROAD.token }} />);
    expect(screen.queryByRole("button", { name: "Clear Address" })).toBeNull();
    unmount();
    render(<Harness places={placesOf()} initial={{ token: ROAD.token }} optional onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear Address" }));
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("says when nothing is found, and Drop a Pin names the spot tapped", async () => {
    const onValue = vi.fn();
    const onPick = vi.fn();
    const places = placesOf({ search: vi.fn().mockResolvedValue([]) });
    render(<Harness places={places} onValue={onValue} onPick={onPick} />);
    await userEvent.type(screen.getByRole("combobox"), "nowhere at all");
    expect(await screen.findByText("No address found")).toBeInTheDocument();
    expect(screen.getByText("Try a nearby landmark or street.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Drop a Pin" }));
    expect(screen.getByText("Tap the spot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tap The Map" }));
    expect(places.pin).toHaveBeenCalledWith({ lat: 6.5095, lon: 3.3711 }, { level: "address" });
    await userEvent.click(await screen.findByRole("button", { name: "Use This Address" }));
    expect(onValue).toHaveBeenLastCalledWith({ token: PIN.token, details: null });
    expect(onPick).toHaveBeenCalledWith(PIN);
    expect(screen.getByText(PIN.formatted)).toBeInTheDocument();
  });

  it("when search is down, says so, hides the pin, and the device's location stands in", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 6.43210123, longitude: 3.4219, accuracy: 12 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const onValue = vi.fn();
    render(<Harness places={placesOf({ search: vi.fn().mockRejectedValue(down()) })} onValue={onValue} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    expect(await screen.findByText("Address search is unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Drop a Pin" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use Current Location" }));
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true, timeout: 15000 }));
    expect(onValue).toHaveBeenLastCalledWith({ device: { lat: 6.432101, lon: 3.4219, accuracy_m: 12 }, details: null });
    expect(screen.getByText(/within 12 m/)).toBeInTheDocument();
  });

  it("says Location blocked when the device refuses, and Try Again searches once more", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: (_ok: PositionCallback, no: PositionErrorCallback) => no({ code: 1 } as GeolocationPositionError) } });
    const search = vi.fn().mockRejectedValueOnce(down(502)).mockResolvedValue([ROAD]);
    render(<Harness places={placesOf({ search })} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await userEvent.click(await screen.findByRole("button", { name: "Use Current Location" }));
    expect(await screen.findByText("Location blocked")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByRole("option", { name: new RegExp(ROAD.formatted) })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("asks a busy search once more before calling search down", async () => {
    const search = vi.fn().mockRejectedValueOnce(down(429)).mockResolvedValue([ROAD]);
    render(<Harness places={placesOf({ search })} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    expect(await screen.findByRole("option", { name: new RegExp(ROAD.formatted) }, { timeout: 1500 })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Address search is unavailable")).toBeNull();
  });

  it("marks an address typed before addresses were picked, and reads a waiting location as Near", () => {
    const typed = sampleToken({ source: "typed", formatted: "14 Old Typed Street, Yaba", lat: null, lon: null, verified: false });
    const { unmount } = render(<Harness places={placesOf()} initial={{ token: typed }} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    unmount();
    const waiting = sampleToken({ source: "device", formatted: null, lat: 6.4321, lon: 3.4219, pending: true, verified: false });
    render(<Harness places={placesOf()} initial={{ token: waiting }} />);
    expect(screen.getByText("Near 6.43210, 3.42190")).toBeInTheDocument();
  });

  it("gives every suggestion a 44 px target on a phone", async () => {
    render(<Harness places={placesOf()} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    (await screen.findAllByRole("option")).forEach((o) => expect(o.className).toContain("phone:min-h-tap"));
  });

  it("has no accessibility violations: empty, listing, holding an address and down", async () => {
    const { container, unmount } = render(<Harness places={placesOf()} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await screen.findByRole("listbox");
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    const held = render(<Harness places={placesOf()} initial={{ token: ROAD.token, details: "Flat 3" }} optional />);
    expect(await axe(held.container)).toHaveNoViolations();
    held.unmount();
    forgetPlaces();
    const off = render(<Harness places={placesOf({ search: vi.fn().mockRejectedValue(down()) })} />);
    await userEvent.type(screen.getByRole("combobox"), "admiralty");
    await screen.findByText("Address search is unavailable");
    expect(await axe(off.container)).toHaveNoViolations();
  });

  it.each([
    ["desktop", 1440],
    ["a phone", 390],
  ])("inside a modal on %s, Esc closes the list first and the modal only after", async (_, width) => {
    setViewport(width);
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add Worksite">
        <Harness places={placesOf()} />
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
