import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { LocationLabel } from "./LocationLabel";

const POINT = { lat: 6.4321, lon: 3.4219 };

describe("LocationLabel", () => {
  it("shows the address the record already carries, and looks nothing up", () => {
    const resolve = vi.fn();
    render(<LocationLabel point={POINT} label="12 Admiralty Way, Lekki" resolve={resolve} />);
    expect(screen.getByText("12 Admiralty Way, Lekki")).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("shows the coordinates until the address arrives", async () => {
    render(<LocationLabel point={POINT} resolve={() => Promise.resolve("12 Admiralty Way, Lekki")} />);
    expect(screen.getByText("6.43210, 3.42190")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("12 Admiralty Way, Lekki")).toBeInTheDocument());
  });

  it("leaves the coordinates when the lookup fails, so it still says where it was", async () => {
    render(<LocationLabel point={POINT} resolve={() => Promise.reject(new Error("no"))} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("6.43210, 3.42190")).toBeInTheDocument();
  });

  it("shows the coordinates alone when nothing can look them up", () => {
    render(<LocationLabel point={POINT} />);
    expect(screen.getByText("6.43210, 3.42190")).toBeInTheDocument();
  });

  it("asks once for the same coordinates, however the object is rebuilt", async () => {
    const resolve = vi.fn().mockResolvedValue("12 Admiralty Way, Lekki");
    const { rerender } = render(<LocationLabel point={{ lat: 6.4321, lon: 3.4219 }} resolve={resolve} />);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    rerender(<LocationLabel point={{ lat: 6.4321, lon: 3.4219 }} resolve={resolve} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("marks the address as content, since it is the record's own value", () => {
    render(<LocationLabel point={POINT} label="12 Admiralty Way, Lekki" />);
    expect(screen.getByText("12 Admiralty Way, Lekki")).toHaveAttribute("data-copy", "content");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<LocationLabel point={POINT} label="12 Admiralty Way, Lekki" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
