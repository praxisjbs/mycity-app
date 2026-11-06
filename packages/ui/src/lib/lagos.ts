import { useEffect, useState } from "react";

/** Lagos keeps UTC+1 all year, so its hour comes straight from the clock. */
export const LAGOS_OFFSET = 1;

/** The hour in Lagos now, minutes as a fraction (0 to 24): what lights the drawn skyline. */
export const lagosHour = (now: Date) => (now.getUTCHours() + LAGOS_OFFSET + now.getUTCMinutes() / 60) % 24;

/** The time now in Lagos as a 24 hour clock reads it (09:05), whatever the device's own zone. */
export function lagosClock(now: Date): string {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET * 3_600_000);
  return `${String(lagos.getUTCHours()).padStart(2, "0")}:${String(lagos.getUTCMinutes()).padStart(2, "0")}`;
}

/** The year it is in Lagos now (the public site's © line). */
export const lagosYear = (now: Date) => new Date(now.getTime() + LAGOS_OFFSET * 3_600_000).getUTCFullYear();

/** The time now, read again as each minute turns: the public site's sky and its footer clock move on with the city. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t = 0;
    const arm = () => {
      t = window.setTimeout(() => {
        setNow(new Date());
        arm();
      }, 60_000 - (Date.now() % 60_000));
    };
    arm();
    return () => window.clearTimeout(t);
  }, []);
  return now;
}
