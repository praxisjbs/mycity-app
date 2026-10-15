import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { installOverlayTestEnv } from "../overlay/test-env";
import { setViewport } from "../testing/viewport";
import { PhoneShell } from "./PhoneShell";
import { PhoneHeader } from "./PhoneHeader";
import { BottomBar } from "./BottomBar";
import { FloatingButton } from "./FloatingButton";
import { BOTTOM_ITEMS } from "./fixtures";

const frame = (props: { fit?: boolean; fab?: boolean } = {}) => (
  <PhoneShell
    fit={props.fit}
    header={<PhoneHeader title="Employee Self-Service" homeHref="/home" />}
    bottomBar={<BottomBar items={BOTTOM_ITEMS(() => undefined)} current="ess" />}
    fab={props.fab === false ? undefined : <FloatingButton actions={[]} onHideHere={() => undefined} />}
  >
    <h1>My Profile</h1>
  </PhoneShell>
);

/* jsdom has no layout: the scroll position is set by hand, then the event fired. */
const scrollTo = (el: HTMLElement, top: number) => {
  Object.defineProperty(el, "scrollTop", { value: top, configurable: true, writable: true });
  fireEvent.scroll(el);
};

beforeAll(installOverlayTestEnv);

describe("PhoneShell", () => {
  it("lays out the header, the page as the main landmark, and the bottom bar", () => {
    setViewport(390);
    render(frame());
    expect(screen.getByRole("main")).toHaveAttribute("data-ui", "scroller");
    expect(screen.getByRole("navigation", { name: "Main" })).toHaveAttribute("data-ui", "phone-nav");
  });

  it("keeps clear space under the page for the floating button, and none without one", () => {
    setViewport(390);
    const { rerender } = render(frame());
    expect(screen.getByRole("main")).toHaveClass("pb-24");
    rerender(frame({ fab: false }));
    expect(screen.getByRole("main")).toHaveClass("pb-6");
  });

  it("slides the title and the floating button away while scrolling down, and back on scrolling up", () => {
    setViewport(390);
    const { container } = render(frame());
    const main = screen.getByRole("main");
    const fab = container.querySelector("[data-fab]")!;
    scrollTo(main, 200);
    expect(fab).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Employee Self-Service").parentElement).toHaveAttribute("aria-hidden", "true");
    scrollTo(main, 120);
    expect(fab).not.toHaveAttribute("aria-hidden");
  });

  it("a fit page hides the floating button so it never covers a composer", () => {
    setViewport(390);
    const { container } = render(frame({ fit: true }));
    expect(container.querySelector("[data-fab]")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    setViewport(390);
    const { container } = render(frame());
    expect(await axe(container)).toHaveNoViolations();
  });
});
