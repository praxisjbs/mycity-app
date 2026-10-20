import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { readSampleToken, SAMPLE_CITIES } from "../maps/fixtures";
import type { Place, Places, PlaceValue } from "../maps/geoapify";
import { forgetPlaces } from "../maps/usePlaces";
import { Field } from "./Field";
import { PlacesField } from "./PlacesField";

const [LAGOS, ABUJA, ENUGU] = SAMPLE_CITIES as [Place, Place, Place];

const placesOf = (search: Places["search"] = vi.fn().mockResolvedValue([LAGOS, ABUJA, ENUGU])): Places => ({
  search,
  pin: vi.fn(),
  read: readSampleToken,
});

function Harness({ places, initial = [], max, onValue }: { places: Places; initial?: PlaceValue[]; max?: number; onValue?: (v: PlaceValue[]) => void }) {
  const [value, setValue] = useState<PlaceValue[]>(initial);
  return (
    <Field label="Cities">
      <PlacesField
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        places={places}
        max={max}
      />
    </Field>
  );
}

beforeAll(installOverlayTestEnv);
beforeEach(forgetPlaces);

describe("PlacesField", () => {
  it("searches cities as it is typed and adds each pick as a chip", async () => {
    const places = placesOf();
    const onValue = vi.fn();
    render(<Harness places={places} onValue={onValue} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Cities" }), "ab");
    await userEvent.click(await screen.findByRole("option", { name: /Abuja/ }));
    expect(places.search).toHaveBeenCalledWith("ab", expect.objectContaining({ level: "city" }));
    expect(onValue).toHaveBeenLastCalledWith([{ token: ABUJA.token }]);
    expect(screen.getByText("Abuja, Nigeria")).toHaveAttribute("data-copy", "content");
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("never offers a city already picked, and never takes typed text", async () => {
    const onValue = vi.fn();
    render(<Harness places={placesOf()} initial={[{ token: LAGOS.token }]} onValue={onValue} />);
    await userEvent.type(screen.getByRole("combobox"), "nigeria");
    await screen.findByRole("listbox", { name: "Places" });
    expect(screen.queryByRole("option", { name: /Lagos/ })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(onValue).not.toHaveBeenCalled();
    await userEvent.click(document.body);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("removes a city with its chip's Remove, or Backspace in an empty box", async () => {
    const onValue = vi.fn();
    render(<Harness places={placesOf()} initial={[{ token: LAGOS.token }, { token: ABUJA.token }]} onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Lagos, Nigeria" }));
    expect(onValue).toHaveBeenLastCalledWith([{ token: ABUJA.token }]);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{Backspace}");
    expect(onValue).toHaveBeenLastCalledWith([]);
  });

  it("adds with the arrows and Enter, and stops offering once the most are picked", async () => {
    const onValue = vi.fn();
    render(<Harness places={placesOf()} initial={[{ token: LAGOS.token }]} max={2} onValue={onValue} />);
    await userEvent.type(screen.getByRole("combobox"), "nigeria");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onValue).toHaveBeenLastCalledWith([{ token: LAGOS.token }, { token: ABUJA.token }]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says when address search is unavailable and offers Try Again", async () => {
    const search = vi.fn().mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 })).mockResolvedValue([ENUGU]);
    render(<Harness places={placesOf(search)} />);
    await userEvent.type(screen.getByRole("combobox"), "enugu");
    expect(await screen.findByText("Address search is unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByRole("option", { name: /Enugu/ })).toBeInTheDocument();
  });

  it("gives every Remove a 44 px target on a phone", () => {
    render(<Harness places={placesOf()} initial={[{ token: LAGOS.token }]} />);
    expect(screen.getByRole("button", { name: "Remove Lagos, Nigeria" }).className).toContain("phone:size-tap");
  });

  it("has no accessibility violations, with chips and with the list open", async () => {
    const { container } = render(<Harness places={placesOf()} initial={[{ token: LAGOS.token }]} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.type(screen.getByRole("combobox"), "nigeria");
    await screen.findByRole("listbox");
    expect(await axe(container)).toHaveNoViolations();
  });
});
