/**
 * @component LocationLabel
 * @group Maps
 * @summary Where a point is, in words: the address our API looks up, with the coordinates until it arrives.
 * @use Beside a clock-in or clock-out, on an attendance row, under a field visit, wherever a reading is shown to a person.
 * @avoid Showing bare coordinates to a person as the final answer; looking the address up from the browser; a label on a point nobody asked about.
 * @phone The same line, wrapping rather than truncating, since an address is content.
 * @a11y The address is text in the reading order, and the coordinates stay available, so a failed lookup still says where it was.
 * @status stable
 * @example <LocationLabel point={punch} resolve={api.resolveAddress} />
 * @example <LocationLabel point={punch} label={punch.address} />
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";
import { describePoint, type LatLon, type ResolveAddress } from "./geoapify";

export interface LocationLabelProps {
  /** The point itself. */
  point: LatLon;
  /** The address, where the record already carries one; nothing is looked up then. */
  label?: string | null;
  /** Turns the point into an address; the app's own call through our proxy. */
  resolve?: ResolveAddress;
  /** Drop the pin glyph (inside a row that already has one). */
  bare?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function LocationLabel({ point, label, resolve, bare, className }: LocationLabelProps) {
  const [found, setFound] = useState<string | null>(label ?? null);
  // The point is looked up by its coordinates, not by the object's identity: a
  // screen that rebuilds `{ lat, lon }` on every render must not re-ask.
  const { lat, lon } = point;

  useEffect(() => {
    if (label || !resolve) return;
    let live = true;
    resolve({ lat, lon })
      .then((address) => live && setFound(address))
      // A lookup that fails leaves the coordinates, which still say where it was.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [label, resolve, lat, lon]);

  const words = label ?? found;
  return (
    <span className={cn("inline-flex items-start gap-1.5 text-xs", className)}>
      {!bare && <Icon name="pin" size="s" className="mt-0.5 flex-none text-subtle-foreground" />}
      <span {...content} className="min-w-0 wrap-any">
        {words ?? describePoint({ lat, lon })}
      </span>
    </span>
  );
}
