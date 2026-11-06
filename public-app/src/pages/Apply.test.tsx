// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Apply } from "./Apply";

/**
 * Apply on the in-browser mock: the link for Head, Sales & Revenue, whose questions are a yes or no,
 * a choice and an optional link. Three steps, checked as they are left, then the receipt.
 */
const draw = (token: string) =>
  render(
    <RouterProvider>
      <Apply token={token} />
    </RouterProvider>,
  );

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const step = (title: string) => screen.findByRole("heading", { level: 2, name: title });

describe("Apply", () => {
  it("holds each step until it is right, then sends the application and shows the reference", async () => {
    const { container } = draw("k7Qm2TxV9pLa");
    const aside = screen.getByRole("complementary", { name: "Apply" });
    expect(await within(aside).findByText("Head, Sales & Revenue")).toBeTruthy();
    expect(within(aside).getByText("Marketing & Sales, Lekki Phase 1, Lagos")).toBeTruthy();
    expect(within(aside).getByText("Your application, in three steps.")).toBeTruthy();
    expect(within(aside).getByText(/^Your CV, a few questions and why this role\. This link works until \d{2}\/\d{2}\/\d{4}\.$/)).toBeTruthy();
    const steps = within(aside).getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")[0]!.getAttribute("aria-current")).toBe("step");
    await step("About You");
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    next();
    expect(await screen.findAllByText("Required")).toHaveLength(3);
    expect(screen.getByText("First and last name")).toBeTruthy();
    type("Full Name", "Adaeze");
    type("Email", "adaeze.okafor@example.com");
    type("Phone", "803 123 4567");
    type("Years of Experience", "9");
    next();
    expect(await screen.findByText("First and last name")).toBeTruthy();
    expect(screen.queryByText("Required")).toBeNull();
    type("Full Name", "Adaeze Okafor");
    next();

    await step("CV and Questions");
    next();
    expect(await screen.findByText("Attach your CV")).toBeTruthy();
    expect(screen.getAllByText("Answer this question")).toHaveLength(2);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.7"], "Adaeze Okafor CV.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Adaeze Okafor CV.pdf", {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Replace" })).toBeTruthy();
    const led = screen.getByRole("radiogroup", { name: "Have you led a sales team of three or more people?" });
    fireEvent.click(within(led).getByRole("radio", { name: "Yes" }));
    const deals = screen.getByRole("radiogroup", { name: "Which best describes the deals you have closed?" });
    fireEvent.click(within(deals).getByRole("radio", { name: "Over ₦50 million a year" }));
    next();

    await step("Why This Role");
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));
    expect(await screen.findByText("Tick to agree")).toBeTruthy();
    expect(screen.getByText("At least 20 characters")).toBeTruthy();
    type("Why This Role", "Too short");
    expect(screen.getByText("At least 20 characters")).toBeTruthy();
    type("Why This Role", "I have grown revenue for two Lagos media brands and want to build MyCityApp's.");
    fireEvent.click(screen.getByRole("checkbox", { name: "I agree to the privacy notice" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    expect(await screen.findByRole("heading", { name: "Application Sent" })).toBeTruthy();
    expect(screen.getByText(/^APP-\d{4}$/)).toBeTruthy();
    expect(screen.getByText("Your Reference")).toBeTruthy();
    expect(screen.getByText("We emailed a copy to adaeze.okafor@example.com.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See Other Roles" })).toBeTruthy();
    expect(within(steps).getAllByRole("listitem").every((li) => li.getAttribute("aria-current") !== "step")).toBe(true);
    expect(screen.queryByText(/score|stage/i)).toBeNull();
    // The whole form walked step by step: past vitest's 5 s on a busy runner, as the long walks in app/ are.
  }, 30000);

  it("counts years with its minus and plus, and goes back without losing what was typed", async () => {
    draw("Bv3nQ8sLp2Wd");
    await step("About You");
    type("Full Name", "Tobi Adeyemi");
    type("Email", "tobi@example.com");
    type("Phone", "0812 345 6789");
    fireEvent.click(screen.getByRole("button", { name: "One More" }));
    fireEvent.click(screen.getByRole("button", { name: "One More" }));
    expect((screen.getByLabelText("Years of Experience") as HTMLInputElement).value).toBe("1");
    next();
    await step("CV and Questions");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await step("About You");
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).value).toBe("Tobi Adeyemi");
    expect((screen.getByLabelText("Years of Experience") as HTMLInputElement).value).toBe("1");
  });

  it("an expired link says it does not open, with the way back to the roles", async () => {
    draw("Wn4cR8yHj2Zs");
    expect(await screen.findByRole("heading", { name: "This Link Does Not Open" })).toBeTruthy();
    expect(screen.getByText("This link is not valid or has expired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See Open Roles" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = draw("Bv3nQ8sLp2Wd");
    await step("About You");
    expect(await axe(container)).toHaveNoViolations();
  });
});
