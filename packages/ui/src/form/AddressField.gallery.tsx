import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { samplePlaceSearch } from "../maps/fixtures";
import type { Place } from "../maps/geoapify";
import { describePoint } from "../maps/geoapify";
import { AddressField } from "./AddressField";
import { Field } from "./Field";
import { KeyValue } from "../display/KeyValue";

const Picking = () => {
  const [address, setAddress] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  return (
    <>
      <Field label="Address">
        <AddressField value={address} onChange={setAddress} search={samplePlaceSearch} onPick={setPlace} placeholder="7 Admiralty Way" />
      </Field>
      {place && <KeyValue items={[["Centre", describePoint(place)]]} />}
    </>
  );
};

const Given = () => {
  const [address, setAddress] = useState("7 Admiralty Way, Lekki Phase 1, Lagos");
  return (
    <Field label="Address" optional>
      <AddressField value={address} onChange={setAddress} search={samplePlaceSearch} />
    </Field>
  );
};

const Failing = () => {
  const [address, setAddress] = useState("");
  return (
    <Field label="Home Address">
      <AddressField value={address} onChange={setAddress} search={() => Promise.reject(new Error("offline"))} placeholder="12 Sample Street" />
    </Field>
  );
};

export default {
  component: "AddressField",
  states: {
    "Type To Search": Picking,
    "Address Given": Given,
    "Search Failing": Failing,
  },
} satisfies GalleryEntry;
