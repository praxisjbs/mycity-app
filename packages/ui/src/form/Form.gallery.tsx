import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Modal } from "../overlay/Modal";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Form, FormFooter } from "./Form";

function RuleForm() {
  const [name, setName] = useState("");
  return (
    <Form onSubmit={() => undefined}>
      <Field label="Rule Name">
        <TextField value={name} onChange={setName} />
      </Field>
      <FormFooter>
        <Button>Cancel</Button>
        <Button variant="primary" type="submit">
          Create Rule
        </Button>
      </FormFooter>
    </Form>
  );
}

const LINES = ["Purpose", "Payee", "Account Name", "Account Number", "Bank", "Notes"] as const;

/** A long form in a modal: on a phone its buttons stay pinned at the foot of the sheet while the fields scroll. */
function InSheet() {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const close = () => setOpen(false);
  return (
    <div ref={ref}>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
        New Request
      </Button>
      <Modal open={open} onClose={close} title="New Request" container={frame}>
        <Form onSubmit={close}>
          {LINES.map((label) => (
            <Field key={label} label={label} optional={label === "Notes"}>
              <TextField value={values[label] ?? ""} onChange={(v) => setValues((o) => ({ ...o, [label]: v }))} />
            </Field>
          ))}
          <FormFooter>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit">
              Send Request
            </Button>
          </FormFooter>
        </Form>
      </Modal>
    </div>
  );
}

export default {
  component: "Form",
  states: {
    "Form With Footer": () => <RuleForm />,
    "In a Sheet": () => <InSheet />,
  },
} satisfies GalleryEntry;
