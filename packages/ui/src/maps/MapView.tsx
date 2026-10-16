/**
 * @component MapView
 * @group Maps
 * @summary A map with the points a screen cares about, drawn by Leaflet on tiles our own API serves.
 * @use Where a clock-in happened, a worksite and its geofence, a partner's address, a field visit.
 * @avoid A map nobody reads a position off; tiles straight from the provider (the key must stay on the server); a map as the only way to read a place.
 * @phone Fits the width at a shorter height, and never takes the page's own scroll: the wheel and pinch are off unless the screen asks for them.
 * @a11y The drawing is hidden from screen readers and every point is listed as words beside it, so the map is never the only way to read a place.
 * @status stable
 * @example <MapView markers={[{ key: "in", lat, lon, label: "Clocked in 07:52" }]} />
 * @example <MapView centre={site} radiusMetres={site.radius_metres} onPick={setPoint} interactive />
 */
import { Suspense, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../display/Skeleton";
import { lazyDraw } from "../charts/lazy";
import { describePoint, LAGOS, TILES, type LatLon } from "./geoapify";
import type { MapDrawProps } from "./MapView.draw";

const Draw = lazyDraw<MapDrawProps>(() => import("./MapView.draw"));

/** One point on the map. */
export interface MapMarker extends LatLon {
  /** Its own key. */
  key: string;
  /** What it is, in words: the tooltip, and the line in the list beside the map. */
  label: string;
  /** `brand` is the yellow pin for the point that matters most; `plain` is City Green. */
  tone?: "brand" | "plain";
}

export interface MapViewProps {
  /** The points to show. */
  markers?: MapMarker[];
  /** Where the map opens; the first marker, or Lagos, unless set. */
  centre?: LatLon;
  /** How close in; 15 unless set (a street), 11 for a city. */
  zoom?: number;
  /** A circle around the first point, in metres: a worksite's geofence. */
  radiusMetres?: number;
  /** Where the tiles come from; our own proxy unless a screen passes its own. */
  tileUrl?: string;
  /** Called with the point pressed, for choosing a place (setting up a worksite). */
  onPick?: (point: LatLon) => void;
  /** Let the person drag and zoom. Off by default, so a map inside a page cannot swallow its scroll. */
  interactive?: boolean;
  /** How tall; `sm` in a card, `md` on a page, `lg` on a screen of its own. */
  height?: "sm" | "md" | "lg";
  /** What sits under the map: an address, a time, a button. */
  children?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

const HEIGHT = { sm: "h-40", md: "h-64", lg: "h-96" } as const;

export function MapView({ markers = [], centre, zoom = 15, radiusMetres, tileUrl = TILES, onPick, interactive, height = "md", children, className }: MapViewProps) {
  const first = markers[0];
  const view = centre ?? (first ? { lat: first.lat, lon: first.lon } : LAGOS);

  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-muted", className)}>
      <div className={cn("w-full", HEIGHT[height])}>
        <Suspense fallback={<Skeleton shape="block" className="size-full" />}>
          <Draw centre={view} zoom={zoom} tileUrl={tileUrl} markers={markers} radiusMetres={radiusMetres} onPick={onPick} interactive={Boolean(interactive)} />
        </Suspense>
      </div>
      {markers.length > 0 && (
        <ul className="sr-only">
          {markers.map((marker) => (
            <li key={marker.key}>{`${marker.label}: ${describePoint(marker)}`}</li>
          ))}
        </ul>
      )}
      {children != null && <div className="border-t border-border bg-card px-3.5 py-2.5">{children}</div>}
    </div>
  );
}
