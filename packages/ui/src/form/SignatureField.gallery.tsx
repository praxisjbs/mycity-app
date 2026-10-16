import { useRef, useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Field } from "./Field";
import { SignatureField, type SignatureFieldHandle } from "./SignatureField";

const Signing = () => {
  const pad = useRef<SignatureFieldHandle>(null);
  const [inked, setInked] = useState(false);
  return (
    <Field label="Your Signature">
      <SignatureField ref={pad} label="Your Signature" onChange={setInked} noClear />
      <div className="mt-2 flex gap-2">
        <Button onClick={() => pad.current?.clear()}>Clear Signature</Button>
        <Button variant="primary" disabled={!inked} onClick={() => undefined}>
          Sign Offer
        </Button>
      </div>
    </Field>
  );
};

export default {
  component: "SignatureField",
  states: {
    Default: () => <SignatureField label="Your Signature" onChange={() => undefined} />,
    Signing,
    "Already Signed": () => <SignatureField label="Your Signature" onChange={() => undefined} disabled />,
  },
} satisfies GalleryEntry;
