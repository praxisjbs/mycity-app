// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { UploadDocuments } from "./UploadDocuments";

/**
 * Upload Documents on the in-browser mock (docs/guides/offers.md §3 step 6): Kunle has not accepted
 * the privacy notice, so the notice comes first and nothing else shows; Chiamaka is part-way, with a
 * document sent back and its reason, a guarantor being checked and her BVN entered; Bola's
 * documentation is complete and the page takes nothing more.
 */
const draw = (token: string) =>
  render(
    <RouterProvider>
      <UploadDocuments token={token} />
    </RouterProvider>,
  );

describe("UploadDocuments", () => {
  it("asks for the privacy notice first, and opens the checklist once it is accepted", async () => {
    draw("Np4xQ7cVm2Ld");
    const notice = await screen.findByRole("region", { name: "Privacy Notice" });
    expect(screen.queryByRole("region", { name: "Your Documents" })).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "Accept Notice" }));
    expect(await within(notice).findByText("Tick to continue")).toBeTruthy();
    fireEvent.click(within(notice).getByRole("checkbox", { name: "I Have Read the Notice" }));
    fireEvent.click(within(notice).getByRole("button", { name: "Accept Notice" }));
    expect(await screen.findByRole("region", { name: "Your Documents" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your Guarantors" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your BVN" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("shows each item's state, a rejection's reason, a guarantor being checked, and the BVN entered", async () => {
    draw("Fw8bK3sHr6Ty");
    const docs = await screen.findByRole("region", { name: "Your Documents" });
    expect(within(docs).getByText(/older than three months/)).toBeTruthy();
    expect(within(docs).getAllByText("Verified").length).toBe(1);
    expect(within(docs).getAllByText("Optional").length).toBe(1);
    const g = screen.getByRole("region", { name: "Your Guarantors" });
    expect(within(g).getByText("Being Checked")).toBeTruthy();
    expect(within(g).getByText("Olumide Bankole, Former line manager")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Your BVN" })).getByText("Entered. Thank you.")).toBeTruthy();
  });

  it("enters the BVN: eleven digits", async () => {
    draw("Np4xQ7cVm2Ld");
    const bvn = await screen.findByRole("region", { name: "Your BVN" }, { timeout: 4000 }).catch(() => null);
    // Kunle accepted the notice in the first test, so his page now opens on the checklist.
    expect(bvn).toBeTruthy();
    fireEvent.change(within(bvn!).getByRole("textbox"), { target: { value: "1234" } });
    fireEvent.click(within(bvn!).getByRole("button", { name: "Save BVN" }));
    expect(await within(bvn!).findByText("Eleven digits")).toBeTruthy();
    fireEvent.change(within(bvn!).getByRole("textbox"), { target: { value: "22233344455" } });
    fireEvent.click(within(bvn!).getByRole("button", { name: "Save BVN" }));
    expect(await within(bvn!).findByText("Entered. Thank you.")).toBeTruthy();
  });

  it("the BVN can be corrected until documentation is done", async () => {
    draw("Fw8bK3sHr6Ty");
    const bvn = await screen.findByRole("region", { name: "Your BVN" });
    fireEvent.click(within(bvn).getByRole("button", { name: "Change BVN" }));
    fireEvent.change(within(bvn).getByRole("textbox"), { target: { value: "22233344456" } });
    fireEvent.click(within(bvn).getByRole("button", { name: "Save BVN" }));
    expect(await within(bvn).findByText("Entered. Thank you.")).toBeTruthy();
  });

  it("the home address is picked, never typed, and a guarantor answers MyCity's form", async () => {
    draw("Fw8bK3sHr6Ty");
    const home = await screen.findByRole("region", { name: "Your Address" });
    fireEvent.click(within(home).getByRole("button", { name: "Save Address" }));
    // Nothing picked: the field says so, and nothing is sent.
    expect(await within(home).findByText(/Pick an address|Required/)).toBeTruthy();
    // The second guarantor's form asks for both addresses, the two answers and an ID copy.
    const g = screen.getByRole("region", { name: "Your Guarantors" });
    const second = within(g).getByRole("region", { name: "Personal Guarantor" });
    for (const label of ["Date of Birth", "Contact Address", "Residential Address", "Ever Convicted", "Recommends You"]) expect(within(second).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(second).getAllByText(/ID Copy/).length).toBeGreaterThan(0);
    fireEvent.click(within(second).getAllByRole("radio", { name: "Yes" })[0]!);
    expect(await within(second).findByText("What Happened")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("says when documentation is complete", async () => {
    draw("Lz2mD9qXc5Wn");
    expect(await screen.findByText("Documents Complete")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your Documents" })).toBeNull();
  });
});
