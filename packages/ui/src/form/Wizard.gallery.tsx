import type { GalleryEntry } from "../testing/gallery";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Wizard } from "./Wizard";

const noop = () => undefined;

export default {
  component: "Wizard",
  states: {
    "Site Panel": () => (
      <Wizard
        look="panel"
        level={2}
        finish="Submit Application"
        onFinish={noop}
        steps={[
          { title: "Contact Details", body: <p className="text-md text-muted-foreground">Full Name, Email and Phone.</p> },
          { title: "CV and Questions", body: <p className="text-md text-muted-foreground">Your CV and the role's questions.</p> },
          { title: "Why This Role", body: <p className="text-md text-muted-foreground">A few lines on why you want it.</p> },
        ]}
      />
    ),
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
