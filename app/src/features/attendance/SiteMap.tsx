import { MapView } from "@mycity/ui";
import { loadTile, pointOf, zoomFor } from "@/features/shared/places";

/**
 * A site's centre and its fence on a small map, under the coordinates of a form that sets
 * one: a worksite, a field assignment's site, a client visit's site. It shows once both
 * coordinates are real, and a tap moves the centre (to six places, about 10 cm). The map
 * never drags, so a sheet keeps its own scroll; the coordinate fields stay the way to
 * type a centre exactly.
 */
export function SiteMap({
  latitude,
  longitude,
  radius,
  min,
  max,
  label,
  onMove,
}: {
  /** The form's Latitude, as typed. */
  latitude: string;
  /** The form's Longitude, as typed. */
  longitude: string;
  /** The form's radius in metres, as typed; the fence is drawn only while it is within bounds. */
  radius: string;
  /** The smallest radius the contract takes. */
  min: number;
  /** The largest radius the contract takes. */
  max: number;
  /** What the pin is: the address, else the site's name. */
  label: string;
  /** Called with the new centre when the map is tapped. */
  onMove: (latitude: string, longitude: string) => void;
}) {
  const point = pointOf(latitude, longitude);
  if (!point) return null;
  const r = Number(radius);
  const fence = radius.trim() && Number.isInteger(r) && r >= min && r <= max ? r : undefined;
  return (
    <MapView
      className="mb-3"
      height="sm"
      zoom={zoomFor(fence ?? min)}
      markers={[{ key: "centre", lat: point.lat, lon: point.lon, label: label.trim() || "Centre", tone: "brand" }]}
      radiusMetres={fence}
      loadTile={loadTile}
      onPick={(p) => onMove(p.lat.toFixed(6), p.lon.toFixed(6))}
    />
  );
}
