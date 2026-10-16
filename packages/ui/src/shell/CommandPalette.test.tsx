import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { CommandPalette, type PaletteResult } from "./CommandPalette";
import { PALETTE_RESULTS } from "./fixtures";

function Harness({ onSelect = vi.fn(), onClose = vi.fn(), results = PALETTE_RESULTS }: { onSelect?: (r: PaletteResult) => void; onClose?: () => void; results?: PaletteResult[] }) {
  const [q, setQ] = useState("");
  return <CommandPalette open onClose={onClose} query={q} onQueryChange={setQ} results={results} onSelect={onSelect} />;
}

beforeAll(installOverlayTestEnv);

describe("CommandPalette", () => {
  it("is a dialog named Search whose line is a combobox over grouped options", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    const box = screen.getByRole("combobox", { name: "Search" });
    expect(box).toHaveFocus();
    expect(screen.getByRole("group", { name: "Screens" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "People" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("moves with the arrow keys and opens the active result with Enter", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSelect={onSelect} onClose={onClose} />);
    const box = screen.getByRole("combobox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const third = screen.getAllByRole("option")[2]!;
    expect(third).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", third.id);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(PALETTE_RESULTS[2]);
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing matches", async () => {
    render(<Harness results={[]} />);
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("on a phone, fills the screen with a Close button", async () => {
    setViewport(390);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close Search" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    render(<Harness />);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
