import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Avatar, Who } from "./Avatar";

describe("Avatar", () => {
  it("shows initials, decorative beside a name", () => {
    const { container } = render(<Avatar name="Cynthia Osakunih" />);
    const el = container.firstElementChild!;
    expect(el).toHaveTextContent("CO");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("size-7");
  });

  it("maps a merged pixel size to the nearest named size", () => {
    const sizes: Array<[number, string]> = [[21, "size-5"], [27, "size-7"], [32, "size-8"], [42, "size-10"], [56, "size-12"]];
    for (const [px, cls] of sizes) {
      const { container, unmount } = render(<Avatar name="Tobi Adeyemi" size={px} />);
      expect(container.firstElementChild?.className).toContain(cls);
      unmount();
    }
  });

  it("is a named image when standalone, presence included", () => {
    render(<Avatar name="Tobi Adeyemi" label="Tobi Adeyemi" online />);
    const img = screen.getByRole("img", { name: "Tobi Adeyemi, Online" });
    expect(img.querySelector("[data-presence=online]")).not.toBeNull();
  });

  it("shows the photo, and falls back to initials when it fails", () => {
    const { container } = render(<Avatar name="Tobi Adeyemi" src="/media/tobi.jpg" />);
    const photo = container.querySelector("img")!;
    expect(photo).toHaveAttribute("alt", "");
    fireEvent.error(photo);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).toHaveTextContent("TA");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Avatar name="Cynthia Osakunih" />
        <Avatar name="Tobi Adeyemi" label="Tobi Adeyemi" presence="away" tone="brand" size="lg" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Who", () => {
  it("shows the name and the second line as content, by the new and the merged prop", () => {
    const { rerender } = render(<Who name="Tobi Adeyemi" role="Field Sales, Lekki" />);
    expect(screen.getByText("Tobi Adeyemi").closest("[data-copy=content]")).not.toBeNull();
    expect(screen.getByText("Field Sales, Lekki")).toBeInTheDocument();
    rerender(<Who name="Tobi Adeyemi" sub="Finance" presence="online" />);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Online")).toHaveClass("sr-only");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Who name="Adaeze Okafor" role="People Lead" presence="busy" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
