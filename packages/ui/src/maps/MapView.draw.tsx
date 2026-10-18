/**
 * The map's own chunk (F21, F22): Leaflet and its stylesheet, loaded only by a
 * screen that shows a map.
 *
 * Tiles come from our API, never from Geoapify directly, so the key stays on
 * the server. The markers are our own `divIcon`s in token classes rather than
 * Leaflet's default images, so nothing depends on an asset path and both
 * themes read.
 *
 * Nothing inside the drawing takes the keyboard. The drawing is hidden from
 * screen readers, because every point is listed in words beside it (MapView),
 * and a hidden thing must not hold focus: Leaflet's keyboard panning, its
 * focusable markers, its zoom control and the Leaflet link it puts in the
 * attribution are all off. The zoom buttons are ours instead, outside the
 * hidden part, so they are named, reachable and 44 px on a phone.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IconButton } from "../actions/Button";
import { ATTRIBUTION, describePoint, type LatLon } from "./geoapify";

export interface MapDrawProps {
  centre: LatLon;
  zoom: number;
  tileUrl: string;
  markers: Array<LatLon & { key: string; label: string; tone?: "brand" | "plain" }>;
  /** A circle around the first marker, in metres (a worksite's geofence). */
  radiusMetres?: number;
  onPick?: (point: LatLon) => void;
  interactive: boolean;
}

/** A pin drawn in our own markup, so no image file has to be found. */
function pin(tone: "brand" | "plain") {
  const colour = tone === "brand" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground";
  return L.divIcon({
    className: "",
    html: `<span class="flex size-5 items-center justify-center rounded-full border-2 border-card shadow-2 ${colour}"><span class="size-1.5 rounded-full bg-current"></span></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
    tooltipAnchor: [0, -12],
  });
}

export default function MapDraw({ centre, zoom, tileUrl, markers, radiusMetres, onPick, interactive }: MapDrawProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // One map for the life of the element; the layers on it are redrawn as the
  // screen's points change.
  useEffect(() => {
    if (!box.current || map.current) return;
    const made = L.map(box.current, {
      center: [centre.lat, centre.lon],
      zoom,
      zoomControl: false,
      dragging: interactive,
      scrollWheelZoom: false,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: false,
      attributionControl: false,
    });
    L.tileLayer(tileUrl, { attribution: ATTRIBUTION, maxZoom: 20, crossOrigin: true }).addTo(made);
    // The licence line only, with no link of Leaflet's own in front of it.
    L.control.attribution({ prefix: false }).addTo(made);
    made.on("click", (e: L.LeafletMouseEvent) => pick.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    drawn.current = L.layerGroup().addTo(made);
    map.current = made;
    return () => {
      made.remove();
      map.current = null;
      drawn.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is made once; its view and layers follow below
  }, []);

  useEffect(() => {
    map.current?.setView([centre.lat, centre.lon], zoom);
  }, [centre.lat, centre.lon, zoom]);

  useEffect(() => {
    const layer = drawn.current;
    if (!layer) return;
    layer.clearLayers();
    for (const marker of markers) {
      L.marker([marker.lat, marker.lon], { icon: pin(marker.tone ?? "plain"), alt: marker.label, keyboard: false })
        .bindTooltip(marker.label, { className: "map-tip", direction: "top" })
        .addTo(layer);
    }
    const first = markers[0];
    if (radiusMetres && first) {
      L.circle([first.lat, first.lon], { radius: radiusMetres, interactive: false, className: "stroke-secondary fill-secondary", weight: 2, fillOpacity: 0.12 }).addTo(layer);
    }
  }, [markers, radiusMetres]);

  return (
    <div className="relative size-full">
      <div
        ref={box}
        className="size-full"
        /* The points are also written out by the component around this, so the map is never the only way to read them. */
        aria-hidden="true"
        data-points={markers.map((m) => describePoint(m)).join("; ")}
      />
      {interactive && (
        /* Over the tiles and over Leaflet's own control corners, which sit at 400 and 1000. */
        <div className="absolute top-2 right-2 z-1001 flex flex-col overflow-hidden rounded-ctl border border-border bg-card shadow-2">
          <IconButton icon="zoomin" label="Zoom In" onClick={() => map.current?.zoomIn()} />
          <IconButton icon="zoomout" label="Zoom Out" onClick={() => map.current?.zoomOut()} />
        </div>
      )}
    </div>
  );
}
