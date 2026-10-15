import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Wizard } from "./Wizard";

const noop = () => undefined;

export default {
  component: "Wizard",
  states: {
    "Three Steps": () => (
      <Wizard
        finish="Publish Vacancy"
        onFinish={noop}
        onCancel={noop}
        steps={[
          {
            title: "The Role",
            body: (
              <Field label="Job Title">
                <TextField value="Partnerships Associate" onChange={noop} />
              </Field>
            ),
          },
          {
            title: "Pay and Hours",
            body: (
              <Field label="Hours Per Week">
                <TextField value="45" onChange={noop} />
              </Field>
            ),
          },
          { title: "Review", body: <p className="text-sm">Ready to publish</p> },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
