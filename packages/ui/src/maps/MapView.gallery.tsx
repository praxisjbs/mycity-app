import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { LocationLabel } from "./LocationLabel";
import { MapView } from "./MapView";
import { IKEJA, LEKKI, SAMPLE_TILE, sampleResolve } from "./fixtures";
import type { LatLon } from "./geoapify";

const Picking = () => {
  const [point, setPoint] = useState<LatLon>(LEKKI);
  return (
    <MapView markers={[{ key: "picked", ...point, label: "Chosen point", tone: "brand" }]} radiusMetres={150} onPick={setPoint} interactive tileUrl={SAMPLE_TILE}>
      <LocationLabel point={point} resolve={sampleResolve} />
    </MapView>
  );
};

export default {
  component: "MapView",
  states: {
    "One Point": () => (
      <MapView markers={[{ key: "in", ...LEKKI, label: "Clocked in 07:52", tone: "brand" }]} height="sm" tileUrl={SAMPLE_TILE}>
        <LocationLabel point={LEKKI} resolve={sampleResolve} />
      </MapView>
    ),
    "Two Points": () => (
      <MapView
        zoom={11}
        tileUrl={SAMPLE_TILE}
        markers={[
          { key: "in", ...LEKKI, label: "Clocked in 07:52", tone: "brand" },
          { key: "out", ...IKEJA, label: "Clocked out 17:04" },
        ]}
      />
    ),
    "A Worksite": () => <MapView markers={[{ key: "site", ...IKEJA, label: "Ikeja Depot" }]} radiusMetres={200} height="sm" tileUrl={SAMPLE_TILE} />,
    Picking,
    "No Point": () => <MapView height="sm" tileUrl={SAMPLE_TILE} />,
  },
} satisfies GalleryEntry;
