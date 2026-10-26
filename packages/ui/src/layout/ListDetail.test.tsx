import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { DetailPane, ListDetail, useSideBySide } from "./ListDetail";

beforeAll(installOverlayTestEnv);
beforeEach(() => setViewport(1440));

const REQUESTS = [
  { id: "a", name: "Adaeze Okonkwo", type: "Annual" },
  { id: "b", name: "Chidi Eze", type: "Sick" },
];

/** A screen as a feature writes one: its first pick only side by side, the picked row everywhere. */
function Requests() {
  const beside = useSideBySide();
  const [picked, setPicked] = useState<string | null>(null);
  const shown = REQUESTS.find((r) => r.id === picked) ?? (beside ? REQUESTS[0] : null);
  return (
    <ListDetail
      open={picked !== null}
      onClose={() => setPicked(null)}
      title="Leave Request"
      list={
        <ul>
          {REQUESTS.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setPicked(r.id)}>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      }
      detail={shown && <p>{`${shown.type} leave for ${shown.name}`}</p>}
    />
  );
}

describe("ListDetail side by side", () => {
  it("shows the list and the first pick together, with no sheet", () => {
    render(<Requests />);
    expect(screen.getByRole("button", { name: "Adaeze Okonkwo" })).toBeInTheDocument();
    expect(screen.getByText("Annual leave for Adaeze Okonkwo")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("swaps the record in place when another row is picked", async () => {
    render(<Requests />);
    await userEvent.click(screen.getByRole("button", { name: "Chidi Eze" }));
    expect(screen.getByText("Sick leave for Chidi Eze")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says it is side by side only from 1181 px", () => {
    const Probe = () => <p>{useSideBySide() ? "Beside" : "Alone"}</p>;
    const { rerender } = render(<Probe />);
    expect(screen.getByText("Beside")).toBeInTheDocument();
    setViewport(1180);
    rerender(<Probe />);
    expect(screen.getByText("Alone")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Requests />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ListDetail on a phone", () => {
  beforeEach(() => setViewport(390));

  it("gives the page the list alone: nothing opens until a row is tapped", () => {
    render(<Requests />);
    expect(screen.getByRole("button", { name: "Adaeze Okonkwo" })).toBeInTheDocument();
    expect(screen.queryByText(/leave for/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the tapped row's record in a sheet titled for it, never below the list", async () => {
    const { container } = render(<Requests />);
    await userEvent.click(screen.getByRole("button", { name: "Chidi Eze" }));
    const sheet = await screen.findByRole("dialog", { name: "Leave Request" });
    expect(sheet).toHaveTextContent("Sick leave for Chidi Eze");
    expect(container).not.toHaveTextContent("Sick leave for Chidi Eze");
  });

  it("closes from its close button, and the list stays as it was", async () => {
    render(<Requests />);
    await userEvent.click(screen.getByRole("button", { name: "Adaeze Okonkwo" }));
    await screen.findByRole("dialog", { name: "Leave Request" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Chidi Eze" })).toBeInTheDocument();
  });

  it("has no accessibility violations with a record open", async () => {
    render(<Requests />);
    await userEvent.click(screen.getByRole("button", { name: "Adaeze Okonkwo" }));
    expect(await axe(await screen.findByRole("dialog"))).toHaveNoViolations();
  });
});

describe("ListDetail between the shells", () => {
  beforeEach(() => setViewport(1000));

  it("opens the record in the centred dialog where two columns do not fit", async () => {
    render(<Requests />);
    expect(screen.queryByText(/leave for/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Adaeze Okonkwo" }));
    expect(await screen.findByRole("dialog", { name: "Leave Request" })).toHaveTextContent("Annual leave for Adaeze Okonkwo");
  });
});

describe("DetailPane", () => {
  function Queries({ initial = null }: { initial?: string | null }) {
    const [picked, setPicked] = useState<string | null>(initial);
    return (
      <>
        <button type="button" onClick={() => setPicked("Q-0042")}>
          Ngozi Bello
        </button>
        <DetailPane open={picked !== null} onClose={() => setPicked(null)} title="Query">
          <p>{picked ?? "Q-0007"} awaiting response</p>
        </DetailPane>
      </>
    );
  }

  it("draws the record where the screen puts it on desktop", () => {
    render(<Queries />);
    expect(screen.getByText("Q-0007 awaiting response")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the page clear on a phone and opens the picked record in a sheet", async () => {
    setViewport(390);
    const { container } = render(<Queries />);
    expect(screen.queryByText(/awaiting response/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ngozi Bello" }));
    expect(await screen.findByRole("dialog", { name: "Query" })).toHaveTextContent("Q-0042 awaiting response");
    expect(container).not.toHaveTextContent("awaiting response");
  });

  it("opens at once on a phone for a record the address names", async () => {
    setViewport(390);
    render(<Queries initial="Q-0042" />);
    expect(await screen.findByRole("dialog", { name: "Query" })).toHaveTextContent("Q-0042 awaiting response");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Queries />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
