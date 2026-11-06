import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Button } from "../actions/Button";
import { FeatureGrid } from "./FeatureGrid";

const tiles = [
  { icon: "pin" as const, title: "Discover Places", text: "Restaurants, experiences and the places worth knowing." },
  { icon: "calendar" as const, title: "Find What's On", text: "Events and what is happening around you, as it happens." },
  { icon: "store" as const, title: "Grow Businesses", text: "Merchants reach new customers and grow their visibility." },
];

const draw = () =>
  render(
    <main>
      <h2>One App, Every City</h2>
      <FeatureGrid feature={{ title: "About MyCityApp", body: <p>MyCityApp is a digital city and lifestyle platform.</p>, action: <Button variant="primary">Visit MyCityApp</Button> }} tiles={tiles} />
    </main>,
  );

describe("FeatureGrid", () => {
  it("draws the feature first, from the left, its words as content, then each tile rising in turn", () => {
    const { container } = draw();
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(4);
    expect(articles[0]).toHaveAttribute("data-reveal", "left");
    expect(screen.getByRole("heading", { level: 3, name: "About MyCityApp" })).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("MyCityApp is a digital city and lifestyle platform.").parentElement).toHaveAttribute("data-copy", "content");
    expect(screen.getByRole("button", { name: "Visit MyCityApp" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Grow Businesses" })).toHaveAttribute("data-ui", "title");
    expect(articles[1]).toHaveAttribute("data-lift", "");
    expect(articles[2]!.getAttribute("style")).toContain("200ms");
  });

  it("has no accessibility violations", async () => {
    const { container } = draw();
    expect(await axe(container)).toHaveNoViolations();
  });
});
