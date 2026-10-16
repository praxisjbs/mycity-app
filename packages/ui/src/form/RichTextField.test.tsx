import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { RichTextField } from "./RichTextField";
import { installEditorTestEnv } from "./test-env";

beforeAll(installEditorTestEnv);

/** The editor is lazy (F22), so every test waits for its chunk. */
const open = async () => {
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument());
};

describe("RichTextField", () => {
  it("holds the space, then draws a named multi-line textbox", async () => {
    const { container } = render(<RichTextField label="Message" value="" onChange={vi.fn()} />);
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
    await open();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("aria-multiline", "true");
  });

  it("offers only the formatting a message needs, each saying whether it is on", async () => {
    render(<RichTextField label="Message" value="" onChange={vi.fn()} />);
    await open();
    expect(screen.getByRole("group", { name: "Message formatting" })).toBeInTheDocument();
    for (const name of ["Bold", "Italic", "Heading", "Bulleted List", "Numbered List", "Quote"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("reports the HTML as the person types", async () => {
    const onChange = vi.fn();
    render(<RichTextField label="Message" value="" onChange={onChange} />);
    await open();
    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    await userEvent.keyboard("Please approve this claim");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toContain("Please approve this claim");
  });

  it("marks a style as on once it is used", async () => {
    render(<RichTextField label="Message" value="" onChange={vi.fn()} />);
    await open();
    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("starts from the HTML it is given", async () => {
    render(<RichTextField label="Message" value="<p>Already written</p>" onChange={vi.fn()} />);
    await open();
    expect(screen.getByText("Already written")).toBeInTheDocument();
  });

  it("shows a sent message with no toolbar at all", async () => {
    render(<RichTextField label="Message" value="<p>Sent last week</p>" onChange={vi.fn()} readOnly />);
    await open();
    expect(screen.getByText("Sent last week")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Message formatting" })).toBeNull();
  });

  it("undo and redo wait until there is something to undo", async () => {
    render(<RichTextField label="Message" value="" onChange={vi.fn()} />);
    await open();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("takes its mark and its id from the Field around it", async () => {
    render(
      <Field label="Message" state="bad" message="Say something">
        <RichTextField label="Message" value="" onChange={vi.fn()} />
      </Field>,
    );
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    const box = screen.getByRole("textbox");
    expect(box.id).toBeTruthy();
    expect(box.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("gives every toolbar button a 44 px target on a phone", async () => {
    render(<RichTextField label="Message" value="" onChange={vi.fn()} />);
    await open();
    expect(screen.getByRole("button", { name: "Bold" }).className).toContain("phone:size-tap");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RichTextField label="Message" value="<p>Hello</p>" onChange={vi.fn()} />);
    await open();
    expect(await axe(container)).toHaveNoViolations();
  });
});
