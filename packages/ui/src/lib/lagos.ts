import { useEffect, useState } from "react";

/** Lagos keeps UTC+1 all year, so its hour comes straight from the clock. */
export const LAGOS_OFFSET = 1;

/** The hour in Lagos now, minutes as a fraction (0 to 24): what lights the drawn skyline. */
export const lagosHour = (now: Date) => (now.getUTCHours() + LAGOS_OFFSET + now.getUTCMinutes() / 60) % 24;

/** The time now, read again each minute: the public site's sky and its footer clock move on with the city. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
