import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Field } from "../form/Field";
import { MapView } from "./MapView";
import { PlaceSearch } from "./PlaceSearch";
import { SAMPLE_PLACES, samplePlaceSearch } from "./fixtures";
import type { Place } from "./geoapify";

const Searching = () => {
  const [place, setPlace] = useState<Place | null>(null);
  return (
    <Field label="Find on Map">
      <PlaceSearch search={samplePlaceSearch} onPick={setPlace} value={place} />
      {place && <MapView className="mt-2" height="sm" markers={[{ key: place.place_id, lat: place.lat, lon: place.lon, label: place.formatted, tone: "brand" }]} radiusMetres={150} />}
    </Field>
  );
};

export default {
  component: "PlaceSearch",
  states: {
    Searching,
    Empty: () => <PlaceSearch search={samplePlaceSearch} onPick={() => undefined} />,
    "Already Chosen": () => <PlaceSearch search={samplePlaceSearch} onPick={() => undefined} value={SAMPLE_PLACES[0]} />,
  },
} satisfies GalleryEntry;
