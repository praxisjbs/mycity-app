import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { offlinePlaces, SAMPLE_CITIES, samplePlaces } from "../maps/fixtures";
import type { PlaceValue } from "../maps/geoapify";
import { Field } from "./Field";
import { PlacesField } from "./PlacesField";

const Empty = () => {
  const [cities, setCities] = useState<PlaceValue[]>([]);
  return (
    <Field label="Cities">
      <PlacesField value={cities} onChange={setCities} places={samplePlaces} />
    </Field>
  );
};

const Picked = () => {
  const [cities, setCities] = useState<PlaceValue[]>(SAMPLE_CITIES.slice(0, 4).map((c) => ({ token: c.token })));
  return (
    <Field label="Cities">
      <PlacesField value={cities} onChange={setCities} places={samplePlaces} />
    </Field>
  );
};

const Unavailable = () => {
  const [cities, setCities] = useState<PlaceValue[]>([{ token: SAMPLE_CITIES[0]!.token }]);
  return (
    <Field label="Cities">
      <PlacesField value={cities} onChange={setCities} places={offlinePlaces} />
    </Field>
  );
};

export default {
  component: "PlacesField",
  states: {
    "Type To Add": Empty,
    "Four Cities": Picked,
    "Search Unavailable": Unavailable,
  },
} satisfies GalleryEntry;
