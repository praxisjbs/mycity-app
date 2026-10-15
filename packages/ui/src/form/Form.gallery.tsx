import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
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

export default {
  component: "Form",
  states: {
    "Form With Footer": () => <RuleForm />,
  },
} satisfies GalleryEntry;
