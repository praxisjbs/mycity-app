// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { RouterProvider } from "@/lib/router";
import { SignOffer } from "./SignOffer";

/**
 * Sign Offer on the in-browser mock (INTERIM until M5): OFF-0018 for Chiamaka Eze waiting, one
 * already signed and one past its day. The letter, the box to sign in, Decline the Offer.
 */
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
  })) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => `data:image/png;base64,${"A".repeat(400)}`) as never;
});

const draw = (token: string) =>
  render(
    <RouterProvider>
      <SignOffer token={token} />
    </RouterProvider>,
  );

const aside = () => screen.getByRole("complementary", { name: "Offer of Employment" });

async function signIn(box: HTMLElement) {
  fireEvent.pointerDown(box, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(box, { clientX: 60, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(box, { pointerId: 1 });
}

describe("SignOffer", () => {
  it("shows the offer in the aside, the letter as issued, and the box to sign in", async () => {
    draw("Rt8wN2kPz5Gb");
    expect(await within(aside()).findByText("Content Producer")).toBeTruthy();
    expect(within(aside()).getByText("Offer of Employment, OFF-0018")).toBeTruthy();
    expect(within(aside()).getByText("Your offer, ready to sign.")).toBeTruthy();
    expect(within(aside()).getByText(/^For Chiamaka Eze, from MyCity App Ltd\. It expires on \d{2}\/\d{2}\/\d{4}\.$/)).toBeTruthy();
    const letter = screen.getByRole("article", { name: "The offer letter" });
    expect(within(letter).getByText("Dear Chiamaka,")).toBeTruthy();
    expect(within(letter).getByText(/^Cynthia Osakunih/).className).toContain("ps-sig-from");
    expect(screen.getByRole("region", { name: "Sign Below" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("Decline the Offer asks for an optional reason, goes back to the offer, and declines", async () => {
    /* The mock's one waiting offer is signed by the test below; the decline is answered here so it stays waiting. */
    const call = api.call.bind(api);
    vi.spyOn(api, "call").mockImplementation(((key: string, opts: never) =>
      key === "POST /api/public/v1/sign/:token/decline"
        ? call("GET /api/public/v1/sign/:token" as never, opts).then((o) => ({ ...(o as object), state: "declined" }))
        : call(key as never, opts)) as never);
    draw("Rt8wN2kPz5Gb");
    fireEvent.click(await screen.findByRole("button", { name: "Decline the Offer" }));
    expect(screen.getByLabelText(/Reason for Declining/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the Offer" }));
    expect(screen.getByRole("button", { name: "Accept and Sign" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline the Offer" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Decline" }));
    expect(await screen.findByRole("heading", { name: "Offer Declined" })).toBeTruthy();
    expect(screen.getByText("We told the hiring team. Thank you for letting us know.")).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("asks for a signature first, then signs, and says so with the reference and Verify This Document", async () => {
    draw("Rt8wN2kPz5Gb");
    fireEvent.click(await screen.findByRole("button", { name: "Accept and Sign" }));
    expect(await screen.findByText("Draw your signature")).toBeTruthy();
    const box = screen.getByRole("img", { name: /^Signature box/ });
    await signIn(box);
    expect(await screen.findByRole("button", { name: "Clear" })).toBeTruthy();
    const steps = within(aside()).getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")[1]!.getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Accept and Sign" }));
    expect(await screen.findByRole("heading", { name: "Offer Signed" })).toBeTruthy();
    expect(screen.getByText("We emailed you a signed copy.")).toBeTruthy();
    expect(screen.getByText("OFF-0018")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Verify This Document" }));
    await waitFor(() => expect(window.location.pathname).toBe("/verify/OFF-0018"));
  });

  it("an offer signed already says so, one past its day has expired, and an unknown link does not open", async () => {
    const signed = draw("Yc3vB6mQh9Ls");
    expect(await screen.findByRole("heading", { name: "Offer Signed" })).toBeTruthy();
    expect(screen.getByText("OFF-0016")).toBeTruthy();
    signed.unmount();
    const expired = draw("Gz7kT4pXw2Nd");
    expect(await screen.findByRole("heading", { name: "This Offer Has Expired" })).toBeTruthy();
    expired.unmount();
    draw("nope");
    expect(await screen.findByRole("heading", { name: "This Link Does Not Open" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("Gz7kT4pXw2Nd");
    await screen.findByRole("heading", { name: "This Offer Has Expired" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
