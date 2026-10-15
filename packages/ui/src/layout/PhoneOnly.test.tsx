import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { DesktopOnly, PhoneOnly } from "./PhoneOnly";

describe("PhoneOnly and DesktopOnly", () => {
  it("hide with CSS at the shell widths by default", () => {
    render(
      <>
        <PhoneOnly>Icon Cards</PhoneOnly>
        <DesktopOnly>Area Chart</DesktopOnly>
      </>,
    );
    expect(screen.getByText("Icon Cards")).toHaveClass("desk:hidden");
    expect(screen.getByText("Area Chart")).toHaveClass("phone:hidden");
  });

  it("render nothing on the other shell with unmount, and follow a resize", () => {
    render(
      <>
        <PhoneOnly unmount>Icon Cards</PhoneOnly>
        <DesktopOnly unmount>Area Chart</DesktopOnly>
      </>,
    );
    expect(screen.queryByText("Icon Cards")).toBeNull();
    expect(screen.getByText("Area Chart")).toBeInTheDocument();
    act(() => setViewport(390));
    expect(screen.getByText("Icon Cards")).toBeInTheDocument();
    expect(screen.queryByText("Area Chart")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        Clocked in <PhoneOnly as="span">today</PhoneOnly>
        <DesktopOnly as="span">at 08:04</DesktopOnly>
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
