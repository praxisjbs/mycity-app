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
        finishLabel="Publish Vacancy"
        onFinish={noop}
        onCancel={noop}
        steps={[
          {
            key: "role",
            title: "The Role",
            content: (
              <Field label="Job Title">
                <TextField value="Partnerships Associate" onChange={noop} />
              </Field>
            ),
          },
          {
            key: "pay",
            title: "Pay and Hours",
            content: (
              <Field label="Hours Per Week">
                <TextField value="45" onChange={noop} />
              </Field>
            ),
          },
          { key: "review", title: "Review", content: <p className="text-sm">Ready to publish</p> },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
