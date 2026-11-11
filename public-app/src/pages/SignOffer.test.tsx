// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { RouterProvider } from "@/lib/router";
import { SignOffer } from "./SignOffer";

/**
 * Sign Offer on the in-browser mock (the signatures routes): OFF-0018 for Dayo Martins waiting, the
 * company having signed; OFF-0017 signed by both; OFF-0013 past its day. Read the letter, confirm the
 * email with the code (482913 on the mock), then name, draw or type, the consent, Accept and Sign;
 * Decline the Offer with its reason.
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

const aside = (name = "Offer of Employment") => screen.getByRole("complementary", { name });

async function signIn(box: HTMLElement) {
  fireEvent.pointerDown(box, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(box, { clientX: 60, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(box, { pointerId: 1 });
}

/** Send Code, then the six digits pasted: a full code checks itself. */
async function confirmEmail(code = "482913") {
  fireEvent.click(await screen.findByRole("button", { name: "Send Code" }));
  expect(await screen.findByText(/^Sent to d•••@example\.test$/)).toBeTruthy();
  const boxes = screen.getAllByRole("textbox").filter((b) => b.getAttribute("inputmode") === "numeric");
  fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => code } });
}

describe("SignOffer", () => {
  it("shows the offer in the aside, the letter as issued, the signers, and asks to confirm the email", async () => {
    draw("Rt8wN2kPz5Gb");
    // The heading follows the document once it loads (an offer here).
    expect(await screen.findByRole("complementary", { name: "Offer of Employment" })).toBeTruthy();
    expect(await within(aside()).findByText("Content Producer")).toBeTruthy();
    expect(within(aside()).getByText("Offer of Employment, OFF-0018")).toBeTruthy();
    expect(within(aside()).getByText("Your offer, ready to sign.")).toBeTruthy();
    expect(within(aside()).getByText(/^For Dayo Martins, from MyCity App Ltd\. It expires on \d{2}\/\d{2}\/\d{4}\.$/)).toBeTruthy();
    const letter = screen.getByRole("article", { name: "The offer letter" });
    expect(within(letter).getByText("Dear Dayo,")).toBeTruthy();
    const signers = screen.getByRole("region", { name: "Signers" });
    expect(within(signers).getByText(/^Signed \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
    expect(within(signers).getByText("Waiting")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Confirm Your Email" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept and Sign" })).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("a wrong code is marked on the code; Decline the Offer asks for a reason and goes back", async () => {
    /* The mock's one waiting offer is signed by the test below; the decline is answered here so it stays waiting. */
    const call = api.call.bind(api);
    vi.spyOn(api, "call").mockImplementation(((key: string, opts: never) =>
      key === "POST /api/public/v1/sign/:token/decline"
        ? call("GET /api/public/v1/sign/:token" as never, opts).then((o) => ({ ...(o as object), state: "declined" }))
        : call(key as never, opts)) as never);
    draw("Rt8wN2kPz5Gb");
    await confirmEmail("111111");
    expect(await screen.findByText("Wrong code")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline the Offer" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Decline" }));
    expect(await screen.findByText("Required")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the Offer" }));
    expect(screen.getByRole("region", { name: "Confirm Your Email" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline the Offer" }));
    fireEvent.change(screen.getByLabelText(/Reason for Declining/), { target: { value: "I took another role" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Decline" }));
    expect(await screen.findByRole("heading", { name: "Offer Declined" })).toBeTruthy();
    expect(screen.getByText("We told the hiring team. Thank you for letting us know.")).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("after the code, asks for a signature and the consent, then signs, with the reference and Verify This Document", async () => {
    draw("Rt8wN2kPz5Gb");
    // The previous test asked for a code a moment ago; the next one may be asked for after a minute.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    await confirmEmail();
    vi.restoreAllMocks();
    expect(await screen.findByRole("region", { name: "Sign Below" })).toBeTruthy();
    const steps = within(aside()).getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")[2]!.getAttribute("aria-current")).toBe("step");
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).value).toBe("Dayo Martins");
    fireEvent.click(screen.getByRole("button", { name: "Accept and Sign" }));
    expect(await screen.findByText("Draw your signature")).toBeTruthy();
    const box = screen.getByRole("img", { name: /^Signature box/ });
    await signIn(box);
    expect(await screen.findByRole("button", { name: "Clear" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Agree to Sign Electronically" }));
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
    expect(screen.getByText("OFF-0017")).toBeTruthy();
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

  describe("an agreement (docs/guides/partnerships.md §6.9)", () => {
    // First: the signing test below signs for the partner, which opens the countersignatory's turn.
    it("MyCity's countersignatory waits for the partner first", async () => {
      draw("Ab8sK2vNe5Wq");
      expect(await screen.findByText(/^You sign after Ngozi Adebayo\./)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send Code" })).toBeNull();
    });
    it("its heading and words follow the document, which reads as its headings, clauses and options table", async () => {
      draw("Ag4pR7wLm2Qx");
      expect(await screen.findByRole("complementary", { name: "Partnership Agreement" })).toBeTruthy();
      expect(within(aside("Partnership Agreement")).getByText("Partnership Agreement, AGR-2026-0007")).toBeTruthy();
      const doc = screen.getByRole("region", { name: "Partnership Agreement" });
      expect(within(doc).getByRole("heading", { name: "Financials" })).toBeTruthy();
      expect(within(doc).getByRole("rowheader", { name: "Deal Price" })).toBeTruthy();
      expect(within(doc).getAllByRole("listitem")).toHaveLength(3);
      const signers = screen.getByRole("region", { name: "Signers" });
      expect(within(signers).getByText("Ngozi Adebayo, Founder")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Decline to Sign" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
      expect(await screen.findByText(/^Sent to n•••@harbourlights\.example\.test$/)).toBeTruthy();
      const boxes = screen.getAllByRole("textbox").filter((b) => b.getAttribute("inputmode") === "numeric");
      fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => "482913" } });
      expect(await screen.findByRole("button", { name: "Sign Agreement" })).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "Type" }));
      fireEvent.change(screen.getByLabelText("Typed Signature"), { target: { value: "Ngozi Adebayo" } });
      fireEvent.click(screen.getByRole("checkbox", { name: "Agree to Sign Electronically" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign Agreement" }));
      expect(await screen.findByRole("heading", { name: "Agreement Signed" })).toBeTruthy();
      expect(await axe(document.body)).toHaveNoViolations();
    });

  });
});
