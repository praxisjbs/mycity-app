import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import organisation from "@mycity/contract/schemas/organisation.js";
import { rules, useContractForm, shortMessage } from "./useContractForm";
import { DateField } from "./DateField";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Form } from "./Form";
import { Wizard } from "./Wizard";
import { Modal } from "../overlay/Modal";
import { useUnsavedChanges } from "../overlay/context";
import { installOverlayTestEnv } from "../overlay/test-env";
import { toast } from "../feedback/toast";

const blank = {
  first_name: "",
  last_name: "",
  work_email: "",
  phone: "",
  job_title: "",
  start_date: "",
  employment_type: "full_time",
  work_pattern: "on_site",
  department_id: "",
};

/** `pauseMs`: how long a pause in typing waits before checking; long where a test checks on leaving only. */
function EmployeeForm({
  onSave,
  pauseMs = 50,
}: {
  onSave: (data: unknown) => void;
  pauseMs?: number;
}) {
  const form = useContractForm(blank, organisation.EmployeeCreate!, {
    pauseMs,
  });
  return (
    <Form onSubmit={form.submit(onSave)}>
      <Field label="First Name" {...form.status("first_name")}>
        <TextField {...form.field("first_name")} />
      </Field>
      <Field label="Work Email" {...form.status("work_email")}>
        <TextField type="email" {...form.field("work_email")} />
      </Field>
      <button type="submit">Create Employee</button>
    </Form>
  );
}

describe("useContractForm", () => {
  it("checks a field when the person leaves it, with a short message", async () => {
    const user = userEvent.setup();
    // No pause check in this test: a slow machine between two keys must not mark the field early.
    render(<EmployeeForm onSave={vi.fn()} pauseMs={60_000} />);
    const email = screen.getByLabelText("Work Email");
    await user.type(email, "ada");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(await screen.findByText("Check the email")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves a field the person only passed through unmarked until Save, so nothing below it moves under the pointer", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EmployeeForm onSave={onSave} pauseMs={60_000} />);
    await user.click(screen.getByLabelText("First Name"));
    await user.tab();
    await user.tab();
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First Name")).not.toHaveAttribute(
      "aria-invalid",
    );
    await user.click(screen.getByRole("button", { name: "Create Employee" }));
    expect(
      (await screen.findAllByText(/Required|Enter/)).length,
    ).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears the mark on the key that fixes it", async () => {
    const user = userEvent.setup();
    render(<EmployeeForm onSave={vi.fn()} />);
    const email = screen.getByLabelText("Work Email");
    await user.type(email, "ada@mycity");
    await user.tab();
    await screen.findByText("Check the email");
    await user.type(email, ".app");
    await vi.waitFor(() =>
      expect(screen.queryByText("Check the email")).not.toBeInTheDocument(),
    );
  });

  it("checks after a pause in typing, before the field is left", async () => {
    const user = userEvent.setup();
    render(<EmployeeForm onSave={vi.fn()} />);
    await user.type(screen.getByLabelText("Work Email"), "ada");
    expect(await screen.findByText("Check the email")).toBeInTheDocument();
  });

  it("never disables submit: it marks every problem, focuses the first and does not save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EmployeeForm onSave={onSave} />);
    const submit = screen.getByRole("button", { name: "Create Employee" });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(await screen.findAllByText("Required")).not.toHaveLength(0);
    expect(onSave).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(screen.getByLabelText("First Name")).toHaveFocus(),
    );
  });

  it("puts a server 422's fields on the same marks", async () => {
    let api:
      | { setServerErrors: (f: Record<string, string[]>) => void }
      | undefined;
    function Probe() {
      const form = useContractForm(
        { ...blank, work_email: "ada@mycityapp.io" },
        organisation.EmployeeCreate!,
      );
      api = form as never;
      return (
        <Field label="Work Email" {...form.status("work_email")}>
          <TextField {...form.field("work_email")} />
        </Field>
      );
    }
    render(<Probe />);
    act(() => api!.setServerErrors({ work_email: ["Already in use"] }));
    expect(await screen.findByText("Already in use")).toBeInTheDocument();
  });

  it("keeps messages to four words", () => {
    expect(
      shortMessage({
        type: "custom",
        message: "must be a Nigerian phone number",
      }),
    ).toBe("Check this value");
    expect(
      shortMessage({ type: "custom", message: "must look like MCA-0001" }),
    ).toBe("Must look like MCA-0001");
    expect(
      shortMessage({
        type: "too_small",
        message: "String must contain at least 1 character(s)",
      }),
    ).toBe("Required");
    expect(
      shortMessage({
        type: "invalid_enum_value",
        message: "Invalid enum value",
      }),
    ).toBe("Choose one");
    expect(shortMessage({ type: "invalid_type", message: "Required" })).toBe(
      "Required",
    );
    expect(
      shortMessage({
        type: "invalid_type",
        message: "Expected object, received string",
      }),
    ).toBe("Required");
    expect(
      shortMessage({ type: "invalid_type", message: "Pick an address" }),
    ).toBe("Pick an address");
    // A limit the schema words itself is shown in its words; Zod's own limits keep the short ones.
    expect(shortMessage({ type: "too_small", message: "At least 150 m" })).toBe(
      "At least 150 m",
    );
    expect(
      shortMessage({ type: "too_small", message: "Add a recipient" }),
    ).toBe("Add a recipient");
    expect(shortMessage({ type: "too_big", message: "At most 500 m" })).toBe(
      "At most 500 m",
    );
    // Zod's own limits say the limit, also when a server 422 carries them raw.
    expect(
      shortMessage({
        type: "too_small",
        message: "String must contain at least 3 character(s)",
      }),
    ).toBe("At least 3 characters");
    expect(
      shortMessage({
        type: "too_big",
        message: "String must contain at most 500 character(s)",
      }),
    ).toBe("At most 500 characters");
    expect(
      shortMessage({
        type: "too_big",
        message: "Number must be less than or equal to 500",
      }),
    ).toBe("At most 500");
    expect(
      shortMessage({
        type: "too_small",
        message: "Number must be greater than or equal to 50",
      }),
    ).toBe("At least 50");
    expect(
      shortMessage({
        type: "custom",
        message: "Array must contain at most 25 element(s)",
      }),
    ).toBe("At most 25");
    expect(
      shortMessage({
        type: "too_big",
        message: "String must contain at most 4000 character(s)",
      }),
    ).toBe("At most 4,000 characters");
    expect(
      shortMessage({
        type: "too_big",
        message: "Number must be less than or equal to 2160",
      }),
    ).toBe("At most 2,160");
    expect(
      shortMessage({
        type: "custom",
        message: "String must contain at least 1 character(s)",
      }),
    ).toBe("Required");
    expect(
      shortMessage({
        type: "invalid_type",
        message: "Expected integer, received float",
      }),
    ).toBe("Whole numbers only");
    // A pattern's own words when they fit; Zod's own "Invalid" keeps the short one.
    expect(
      shortMessage({ type: "invalid_string", message: "Ten digits" }),
    ).toBe("Ten digits");
    expect(
      shortMessage({ type: "invalid_string", message: "Not a price" }),
    ).toBe("Not a price");
    expect(shortMessage({ type: "invalid_string", message: "Invalid" })).toBe(
      "Check the format",
    );
    expect(
      shortMessage({ type: "invalid_string", message: "Invalid email" }),
    ).toBe("Check the email");
  });

  it("never calls a number too long: a limit no schema worded reads by what it limits", () => {
    const long = "Value is far beyond what this field allows here";
    expect(
      shortMessage({
        type: "too_big",
        message: long,
        kind: "number",
        maximum: 90,
      }),
    ).toBe("At most 90");
    expect(
      shortMessage({
        type: "too_small",
        message: long,
        kind: "number",
        minimum: -180,
      }),
    ).toBe("At least -180");
    expect(
      shortMessage({ type: "too_big", message: long, kind: "number" }),
    ).toBe("Too high");
    expect(
      shortMessage({ type: "too_big", message: long, kind: "array" }),
    ).toBe("Too many");
    expect(
      shortMessage({ type: "too_small", message: long, kind: "date" }),
    ).toBe("Too early");
    expect(
      shortMessage({ type: "too_big", message: long, kind: "string" }),
    ).toBe("Too long");
    expect(shortMessage({ type: "too_big", message: long })).toBe("Too long");
  });

  it("marks a worksite's centre outside its range with the whole range, and keeps the ends", async () => {
    const worksites = (await import("@mycity/contract/schemas/worksites.js"))
      .default;
    const schema = worksites.WorksiteCreate!;
    const centre = (latitude: string, longitude: string) => ({
      name: "Testbed Office",
      latitude: Number(latitude),
      longitude: Number(longitude),
      radius_m: 100,
    });
    function Centre() {
      const f = useContractForm(
        { latitude: "91", longitude: "181" },
        {
          safeParse: (v: { latitude: string; longitude: string }) =>
            schema.safeParse(centre(v.latitude, v.longitude)),
        },
        { pauseMs: 10 },
      );
      return (
        <>
          <Field label="Latitude" {...f.status("latitude")}>
            <TextField {...f.field("latitude")} />
          </Field>
          <Field label="Longitude" {...f.status("longitude")}>
            <TextField {...f.field("longitude")} />
          </Field>
          <button type="button" onClick={() => f.check()}>
            Add Worksite
          </button>
          <button
            type="button"
            onClick={() => (
              f.set("latitude", "-90"),
              f.set("longitude", "180")
            )}
          >
            Set Ends
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Centre />);
    await user.click(screen.getByRole("button", { name: "Add Worksite" }));
    expect(await screen.findByText("From -90 to 90")).toBeInTheDocument();
    expect(screen.getByText("From -180 to 180")).toBeInTheDocument();
    expect(screen.queryByText("Too long")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set Ends" }));
    await vi.waitFor(() =>
      expect(screen.queryByText("From -90 to 90")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("From -180 to 180")).not.toBeInTheDocument();
  });

  it("shows an empty field the schema's own words for it, else Required", () => {
    const schema = {
      safeParse: () => ({
        success: false,
        error: {
          issues: [
            { path: ["model"], code: "too_small", message: "Pick a model" },
            {
              path: ["name"],
              code: "too_small",
              message: "String must contain at least 1 character(s)",
            },
            { path: ["price"], code: "invalid_string", message: "Not a price" },
          ],
        },
      }),
    };
    const { result } = renderHook(() =>
      useContractForm({ model: "", name: "", price: "" }, schema),
    );
    act(() => {
      result.current.check();
    });
    expect(result.current.errors).toEqual({
      model: "Pick a model",
      name: "Required",
      price: "Required",
    });
  });
});

describe("useContractForm with INTERIM rules", () => {
  it("check() marks everything and reports cleanliness", () => {
    const { result } = renderHook(() =>
      useContractForm({ name: "" }, { name: rules.required() }),
    );
    let ok = true;
    act(() => {
      ok = result.current.check();
    });
    expect(ok).toBe(false);
    expect(result.current.status("name")).toEqual({
      state: "bad",
      message: "Required",
    });
  });

  it("takes only lists of messages as marks: a refusal's details are not", () => {
    const { result } = renderHook(() =>
      useContractForm({ email: "ada@mycity.app" }),
    );
    act(() =>
      result.current.setServerErrors({
        email: ["Already in use"],
        reason: "Connection refused" as never,
        smtp_code: 421 as never,
      }),
    );
    expect(result.current.field("email").message).toBe("Already in use");
  });

  it("shows a server error until the field changes", () => {
    const { result } = renderHook(() =>
      useContractForm({ email: "ada@mycity.app" }),
    );
    act(() => result.current.setServerErrors({ email: ["Already in use"] }));
    expect(result.current.field("email").message).toBe("Already in use");
    act(() => result.current.field("email").onChange("ola@mycity.app"));
    expect(result.current.field("email").message).toBeUndefined();
  });

  it("leaves no mark on a field emptied by reset straight after typing", async () => {
    const user = userEvent.setup();
    function CommentBox() {
      const form = useContractForm(
        { body: "" },
        { body: rules.required() },
        { pauseMs: 50 },
      );
      return (
        <>
          <Field label="Comment" {...form.status("body")}>
            <TextField {...form.field("body")} />
          </Field>
          <button
            type="button"
            onClick={() => form.check() && form.reset({ body: "" })}
          >
            Add Comment
          </button>
        </>
      );
    }
    render(<CommentBox />);
    const box = screen.getByLabelText("Comment");
    await user.type(box, "Looks good");
    await user.click(screen.getByRole("button", { name: "Add Comment" }));
    expect(box).toHaveValue("");
    // Past the pause the last key started: the emptied box stays unmarked.
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
  });

  it("keeps every rule message to four words", () => {
    for (const msg of [
      rules.required()(""),
      rules.email(""),
      rules.email("x"),
      rules.email("x@y"),
      rules.amount(""),
      rules.amount("1.234"),
    ]) {
      expect(String(msg).split(" ").length).toBeLessThanOrEqual(4);
    }
  });
});

describe("useContractForm and what only a control can see", () => {
  function DueForm({ onSave }: { onSave: (data: unknown) => void }) {
    const form = useContractForm(
      { due: "" },
      { due: rules.required("Pick a day") },
      { pauseMs: 50 },
    );
    return (
      <Form onSubmit={form.submit(onSave)}>
        <Field label="Due Date" {...form.status("due")}>
          <DateField {...form.field("due")} min="2026-10-21" />
        </Field>
        <button type="submit">Save Task</button>
      </Form>
    );
  }

  it("marks a typed day outside the field's range at once, and never saves it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DueForm onSave={onSave} />);
    const due = screen.getByLabelText("Due Date");
    await user.type(due, "01/10/2026");
    expect(screen.getByText("Pick 21/10/2026 or later")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(onSave).not.toHaveBeenCalled();
    await user.clear(due);
    await user.type(due, "28/10/2026");
    await vi.waitFor(() =>
      expect(
        screen.queryByText("Pick 21/10/2026 or later"),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(onSave).toHaveBeenCalledWith({ due: "2026-10-28" });
  });

  it("refuses half a date on Save, though the value under it is empty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DueForm onSave={onSave} />);
    await user.type(screen.getByLabelText("Due Date"), "28/10/202");
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(await screen.findByText("Not a real date")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("useContractForm and the overlay around it (unsaved changes)", () => {
  beforeAll(installOverlayTestEnv);

  const named = { name: "", email: "" };
  const need = { name: rules.required(), email: rules.email };

  /** A two-step wizard in a modal's body, one form per step, as New Lead is. */
  function LeadWizard({ onClose }: { onClose: () => void }) {
    return (
      <Modal open onClose={onClose} title="New Lead">
        <LeadSteps onCancel={onClose} />
      </Modal>
    );
  }

  function LeadSteps({ onCancel }: { onCancel: () => void }) {
    const org = useContractForm({ name: "" }, { name: rules.required() });
    const contact = useContractForm({ email: "" }, { email: rules.email });
    return (
      <Wizard
        finish="Create Lead"
        onCancel={onCancel}
        onFinish={() => undefined}
        steps={[
          {
            title: "Organisation",
            check: () => org.check(),
            body: (
              <Field label="Organisation" {...org.status("name")}>
                <TextField {...org.field("name")} />
              </Field>
            ),
          },
          {
            title: "Contact",
            check: () => contact.check(),
            body: (
              <Field label="Email" {...contact.status("email")}>
                <TextField {...contact.field("email")} />
              </Field>
            ),
          },
        ]}
      />
    );
  }

  it("closes a wizard with nothing typed at once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LeadWizard onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks once before Esc or the close button discards a wizard's entries, from any step", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LeadWizard onClose={onClose} />);
    await user.type(screen.getByLabelText("Organisation"), "Lekki Gardens");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Contact" }),
    ).toBeInTheDocument();

    // The step in view has nothing typed; the step behind it does.
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("alertdialog", { name: "Discard Changes" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(
      screen.getByRole("dialog", { name: "New Lead" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getAllByRole("alertdialog", { name: "Discard Changes" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  /** One form in a modal that stays open after saving; `extra` is a change the screen holds outside the form. */
  function StaysOpen({
    save,
    onClose,
    extra = false,
    alsoScreen = false,
    unsaved,
  }: {
    save: () => unknown;
    onClose: () => void;
    extra?: boolean;
    alsoScreen?: boolean;
    unsaved?: boolean;
  }) {
    function Body() {
      const f = useContractForm(
        named,
        need,
        unsaved === undefined ? {} : { unsaved },
      );
      // A screen that still says so itself, as some did before the form did: one flag each, never a clash.
      useUnsavedChanges(alsoScreen ? f.isDirty : false);
      useUnsavedChanges(extra);
      return (
        <Form onSubmit={f.submit(save)}>
          <Field label="Name" {...f.status("name")}>
            <TextField {...f.field("name")} />
          </Field>
          <Field label="Email" {...f.status("email")}>
            <TextField {...f.field("email")} />
          </Field>
          <button type="submit">Save Contact</button>
        </Form>
      );
    }
    return (
      <Modal open onClose={onClose} title="Edit Contact">
        <Body />
      </Modal>
    );
  }

  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@mycity.app");
  };

  it("clears the question once a save succeeds, and raises it again on the next edit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const save = vi.fn(() => Promise.resolve());
    render(<StaysOpen save={save} onClose={onClose} alsoScreen />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Save Contact" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => undefined);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();

    // The modal here stays open whatever onClose does; the next edit raises the question again.
    await user.type(screen.getByLabelText("Name"), " Obi");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Discard Changes" })).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps asking after a save that was refused, whether the server marked a field or only a toast said so", async () => {
    const user = userEvent.setup();
    const failToast = vi.fn(() =>
      Promise.resolve(void toast.error("Not saved. Try again.")),
    );
    const { unmount } = render(
      <StaysOpen save={failToast} onClose={() => undefined} />,
    );
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Save Contact" }));
    await waitFor(() => expect(failToast).toHaveBeenCalledOnce());
    await act(async () => undefined);
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("alertdialog", { name: "Discard Changes" }),
    ).toBeInTheDocument();
    unmount();

    const rejected = vi.fn(() => Promise.reject(new Error("422")));
    render(
      <StaysOpen
        save={() => rejected().catch(() => false)}
        onClose={() => undefined}
      />,
    );
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Save Contact" }));
    await waitFor(() => expect(rejected).toHaveBeenCalledOnce());
    await act(async () => undefined);
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("alertdialog", { name: "Discard Changes" }),
    ).toBeInTheDocument();
  });

  it("keeps the screen's own flag up when the form has none", async () => {
    const user = userEvent.setup();
    render(
      <StaysOpen save={() => undefined} onClose={() => undefined} extra />,
    );
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("alertdialog", { name: "Discard Changes" }),
    ).toBeInTheDocument();
  });

  it("says nothing for a form that opts out", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <StaysOpen save={() => undefined} onClose={onClose} unsaved={false} />,
    );
    await fill(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears the flag with saved() for a form saved through check()", () => {
    const { result } = renderHook(() => useContractForm(named, need));
    act(() => result.current.set("name", "Ada"));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.saved());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.values.name).toBe("Ada");
  });
});
