import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { axe } from "../testing/axe";
import { NoteTaker, type NoteTakerProps } from "./NoteTaker";

function Harness(props: Partial<NoteTakerProps>) {
  const [value, setValue] = useState("Lock the screen before leaving the desk.");
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Take Notes
      </button>
      <p>The lesson goes on behind the notes.</p>
      <NoteTaker open={open} onClose={() => setOpen(false)} subject="NDPA Data Protection Essentials" value={value} onChange={setValue} saved="saved" {...props} />
    </>
  );
}

describe("NoteTaker", () => {
  it("shows the note in a named region over the page, without blocking it", () => {
    render(<Harness />);
    const region = screen.getByRole("region", { name: "My Notes" });
    expect(region).toHaveTextContent("NDPA Data Protection Essentials");
    expect(screen.getByRole("textbox", { name: "My Notes on NDPA Data Protection Essentials" })).toHaveValue("Lock the screen before leaving the desk.");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    // Not a dialog: nothing behind it is hidden from the person or their screen reader.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("The lesson goes on behind the notes.")).toBeVisible();
  });

  it("hands every keystroke to the screen", () => {
    const onChange = vi.fn();
    render(<NoteTaker open onClose={() => undefined} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "My Notes" }), { target: { value: "Report a lost phone" } });
    expect(onChange).toHaveBeenCalledWith("Report a lost phone");
  });

  it("minimises to its bar and opens again; Close Notes closes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Minimise Notes" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Notes" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Notes" }));
    expect(screen.queryByRole("region", { name: "My Notes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take Notes" }));
    expect(screen.getByRole("textbox")).toHaveValue("Lock the screen before leaving the desk.");
  });

  it("moves with the arrow keys on Move Notes, staying inside the window", () => {
    render(<Harness />);
    const region = screen.getByRole("region", { name: "My Notes" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Move Notes" }), { key: "ArrowLeft" });
    expect(region.className).toContain("left-(--note-x)");
    expect(region.style.getPropertyValue("--note-x")).toMatch(/^\d+px$/);
  });

  it("says when a save failed, with Try Again", () => {
    const onRetry = vi.fn();
    render(<Harness saved="failed" onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not saved");
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
