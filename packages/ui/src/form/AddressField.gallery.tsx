import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { offlinePlaces, samplePlaces, SAMPLE_PLACES, sampleToken } from "../maps/fixtures";
import type { Place, PlaceValue } from "../maps/geoapify";
import { describePoint } from "../maps/geoapify";
import { AddressField } from "./AddressField";
import { Field } from "./Field";
import { KeyValue } from "../display/KeyValue";

const Picking = () => {
  const [address, setAddress] = useState<PlaceValue | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  return (
    <>
      <Field label="Address">
        <AddressField value={address} onChange={setAddress} places={samplePlaces} onPick={setPlace} />
      </Field>
      {place && <KeyValue items={[["Centre", describePoint(place)]]} />}
    </>
  );
};

const Picked = () => {
  const [address, setAddress] = useState<PlaceValue | null>({ token: SAMPLE_PLACES[0]!.token, details: "Flat 3, blue gate" });
  return (
    <Field label="Address" optional>
      <AddressField value={address} onChange={setAddress} places={samplePlaces} />
    </Field>
  );
};

const TypedBefore = () => {
  const [address, setAddress] = useState<PlaceValue | null>({
    token: sampleToken({ source: "typed", formatted: "14 Old Typed Street, Yaba, Lagos", lat: null, lon: null, verified: false }),
  });
  return (
    <Field label="Home Address">
      <AddressField value={address} onChange={setAddress} places={samplePlaces} />
    </Field>
  );
};

const Area = () => {
  const [location, setLocation] = useState<PlaceValue | null>(null);
  return (
    <Field label="Location">
      <AddressField value={location} onChange={setLocation} places={samplePlaces} level="area" placeholder="Lekki Phase 1" />
    </Field>
  );
};

const Unavailable = () => {
  const [address, setAddress] = useState<PlaceValue | null>(null);
  return (
    <Field label="Home Address">
      <AddressField value={address} onChange={setAddress} places={offlinePlaces} />
    </Field>
  );
};

const CurrentLocation = () => {
  const [address, setAddress] = useState<PlaceValue | null>({ device: { lat: 6.5095, lon: 3.379, accuracy_m: 12 } });
  return (
    <Field label="Home Address">
      <AddressField value={address} onChange={setAddress} places={offlinePlaces} />
    </Field>
  );
};

const Waiting = () => {
  const [address, setAddress] = useState<PlaceValue | null>({
    token: sampleToken({ source: "device", formatted: null, lat: 6.5095, lon: 3.379, verified: false, pending: true }),
    details: "Blue gate",
  });
  return (
    <Field label="Address" optional>
      <AddressField value={address} onChange={setAddress} places={samplePlaces} />
    </Field>
  );
};

export default {
  component: "AddressField",
  states: {
    "Type To Search": Picking,
    "Address Picked": Picked,
    "Typed Before": TypedBefore,
    "Area Level": Area,
    "Search Unavailable": Unavailable,
    "Current Location": CurrentLocation,
    "Waiting For Name": Waiting,
  },
} satisfies GalleryEntry;
