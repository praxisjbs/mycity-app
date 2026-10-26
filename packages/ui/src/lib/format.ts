/**
 * How values read on screen (FRONTEND_GUIDE §6). The wire carries ISO dates and
 * money as decimal strings; people read day-first dates and Naira.
 *
 * Nothing here does arithmetic on money (gate 20): amounts are formatted from
 * their string digits, never through a float.
 */
const TZ = "Africa/Lagos";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-13" or a full ISO timestamp → "13/10/2026". Empty for nothing. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  const parts = lagosParts(iso);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : "";
}

/** ISO timestamp → "09:14" in Lagos time. */
export function formatTime(iso: string | null | undefined): string {
  const parts = iso ? lagosParts(iso) : null;
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

/** ISO timestamp → "13/10/2026 09:14". */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? `${formatDate(iso)} ${formatTime(iso)}` : "";
}

/** ISO timestamp → "09:14" today, "Yesterday", or a day-first date. For lists of messages. */
export function formatWhen(iso: string | null | undefined, now = new Date()): string {
  const p = iso ? lagosParts(iso) : null;
  if (!p) return "";
  const today = lagosParts(now.toISOString());
  const yesterday = lagosParts(new Date(now.getTime() - 86400000).toISOString());
  const key = (x: NonNullable<typeof p>) => `${x.year}-${x.month}-${x.day}`;
  if (today && key(p) === key(today)) return `${p.hour}:${p.minute}`;
  if (yesterday && key(p) === key(yesterday)) return "Yesterday";
  return `${p.day}/${p.month}/${p.year}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" or "2026-10-01" → "October 2026". */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}

/** Month name from a zero-based index: 0 → "January". */
export const monthName = (index0: number) => MONTHS[index0] ?? "";

function lagosParts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const part of f.formatToParts(d)) out[part.type] = part.value;
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute };
}

/**
 * The wall clock in another city, for the sign-in screen's cities: the time
 * ("19:42"), the day as a person says it ("Wednesday 16 October", day first),
 * and the hour as a number (with minutes as a fraction) for the scene's light.
 */
export function zoneClock(now: Date, timeZone: string): { time: string; day: string; hour: number } {
  // @date-format:parts the parts are read by name and joined day first below
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const out: Record<string, string> = {};
  for (const part of f.formatToParts(now)) out[part.type] = part.value;
  const hour = Number(out.hour) % 24;
  const minute = Number(out.minute);
  return { time: `${pad(hour)}:${pad(minute)}`, day: `${out.weekday} ${out.day} ${out.month}`, hour: hour + minute / 60 };
}

/** Today in Lagos as ISO "YYYY-MM-DD". */
export function todayIso(now = new Date()): string {
  const p = lagosParts(now.toISOString());
  return p ? `${p.year}-${p.month}-${p.day}` : now.toISOString().slice(0, 10);
}

/** An ISO day some days on (or back, for a negative n): a date field's `max`, "2026-10-26" and 90 → "2027-01-24". */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day-first text a person typed ("13/10/2026", "13-10-2026", "13.10.26") → ISO, or null. */
export function parseDayFirst(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if ((m[3] ?? "").length === 2) y += 2000;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/* ------------------------------------------------------------------ *
 * Money: "1250000.00" → "₦1,250,000.00"
 * ------------------------------------------------------------------ */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Full amount with kobo, for tables and documents. */
export function formatMoney(amount: string | null | undefined, opts: { kobo?: boolean } = {}): string {
  if (amount == null || amount === "") return "";
  const neg = amount.startsWith("-");
  const [whole = "", frac = "00"] = amount.replace(/^-/, "").split(".");
  const body = `₦${group(whole.replace(/^0+(?=\d)/, ""))}${opts.kobo === false ? "" : `.${frac.padEnd(2, "0").slice(0, 2)}`}`;
  return neg ? `−${body}` : body;
}

/** Short form for KPI tiles only: "₦1.3M", "₦850K". */
export function formatMoneyShort(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "";
  const neg = amount.startsWith("-");
  const whole = (amount.replace(/^-/, "").split(".")[0] ?? "").replace(/^0+(?=\d)/, "");
  const scale = (len: number, unit: string) => {
    const head = whole.slice(0, whole.length - len) || "0";
    const next = whole.charAt(whole.length - len) || "0";
    const out = head.length >= 3 || next === "0" ? head : `${head}.${next}`;
    return `${out}${unit}`;
  };
  let body: string;
  if (whole.length > 9) body = scale(9, "B");
  else if (whole.length > 6) body = scale(6, "M");
  else if (whole.length > 3) body = `${whole.slice(0, whole.length - 3)}K`;
  else body = whole;
  return `${neg ? "−" : ""}₦${body}`;
}

/** Is this amount below zero? (string check; no float) */
export const isNegative = (amount: string | null | undefined) => !!amount && amount.startsWith("-") && /[1-9]/.test(amount);

/** Whole-number count with thousands separators. */
export const formatCount = (n: number | null | undefined) => (n == null ? "" : group(String(n)));

/* ------------------------------------------------------------------ *
 * Quantities: "64000.0000" → "64,000", with its unit
 * ------------------------------------------------------------------ */

/** A sign written before the figure rather than after it. */
const CURRENCY_SIGN = /^[₦$£€]$/;

/** A JS number as plain digits: never "1e-7". */
const plainDigits = (n: number) => (Number.isFinite(n) ? (/e/i.test(String(n)) ? n.toFixed(4) : String(n)) : "");

/**
 * A target, actual, baseline or KPI figure as people write it: thousands grouped, trailing zeros
 * dropped, a per cent sign against it ("40%"), a currency sign before it ("₦30,000,000") and any
 * other unit after it ("64,000 users"). Formatted from the decimal string's digits, never through a
 * float, so every place it carries is kept. Empty for nothing; words that are not a number come back
 * as they are. Money with kobo is formatMoney's.
 */
export function formatNumber(value: string | number | null | undefined, unit?: string | null): string {
  if (value == null || value === "") return "";
  const raw = typeof value === "number" ? plainDigits(value) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) return raw;
  const whole = (m[2] ?? "").replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const neg = m[1] === "-" && /[1-9]/.test(whole + frac);
  const figure = `${group(whole)}${frac ? `.${frac}` : ""}`;
  const u = (unit ?? "").trim();
  const body = !u ? figure : u === "%" ? `${figure}%` : CURRENCY_SIGN.test(u) ? `${u}${figure}` : `${figure} ${u}`;
  return neg ? `−${body}` : body;
}

/** Initials for an avatar: "Cynthia Osakunih" → "CO". */
export function initials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** "84 KB", "1.1 MB", "23.4 GB", "1.25 TB" from a byte count. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

/** Plural with count: plural(3, "employee") → "3 employees". */
export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

const NIGERIAN = /^\+234(\d{3})(\d{3})(\d{4})$/;

/** A stored number (E.164) as people read it: "+234 803 123 4567"; a number from abroad as stored. */
export function formatPhone(e164: string | null | undefined): string {
  const v = (e164 ?? "").trim();
  const ng = NIGERIAN.exec(v);
  return ng ? `+234 ${ng[1]} ${ng[2]} ${ng[3]}` : v;
}

/** A stored number as a person types it at home, for a field to start from: "0803 123 4567". */
export function formatPhoneLocal(e164: string | null | undefined): string {
  const v = (e164 ?? "").trim();
  const ng = NIGERIAN.exec(v);
  return ng ? `0${ng[1]} ${ng[2]} ${ng[3]}` : v;
}
