import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { ChannelGrid } from "./ChannelGrid";

beforeAll(installOverlayTestEnv);
afterEach(() => setViewport(1440));

const columns = [
  { key: "in_app", label: "In App" },
  { key: "push", label: "Push" },
];
const rows = [
  { key: "security", label: "Security", values: { in_app: true, push: true }, locked: { in_app: true, push: true } },
  { key: "comms", label: "Messages and Mail", values: { in_app: true, push: false } },
];

describe("ChannelGrid", () => {
  it("on desktop, each switch is named by its row and column and saves on its own; a locked one cannot change", async () => {
    const onChange = vi.fn();
    render(<ChannelGrid label="Where Notices Reach You" columns={columns} rows={rows} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Messages and Mail, Push" }));
    expect(onChange).toHaveBeenCalledWith("comms", "push", true);
    expect(screen.getByRole("switch", { name: "Security, Push" })).toBeDisabled();
  });

  it("on a phone, a row says what is on and opens a sheet of switches", async () => {
    setViewport(390);
    const onChange = vi.fn();
    render(<ChannelGrid columns={columns} rows={rows} onChange={onChange} />);
    const row = screen.getByRole("button", { name: /Messages and Mail/ });
    expect(row).toHaveTextContent("In App");
    await userEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Messages and Mail" });
    expect(sheet).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /Push/ }));
    expect(onChange).toHaveBeenCalledWith("comms", "push", true);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ChannelGrid label="Where Notices Reach You" columns={columns} rows={rows} onChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
