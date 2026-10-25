// Date, money and size formatting shared by the API and the React app.
// Dates are stored as local "YYYY-MM-DD" and timestamps as local "YYYY-MM-DDTHH:MM:SS".

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoDateTime(d: Date = new Date()): string {
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parse "YYYY-MM-DD" (or the date part of a timestamp) as a local date. */
export function parseDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function parseDateTime(value: string): Date {
  const [date, time = "00:00:00"] = value.split("T");
  const [h, mi, s] = time.split(":").map(Number);
  const d = parseDate(date);
  d.setHours(h || 0, mi || 0, s || 0);
  return d;
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isoDate(parseDate(value)) === value;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function today(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from today until the date (negative if past). */
export function daysFromToday(value: string): number {
  return Math.round((parseDate(value).getTime() - today().getTime()) / 86_400_000);
}

/** A tiny strftime: %-d %d %b %B %Y %a %A %H %M. */
export function strftime(d: Date, fmt: string): string {
  return fmt.replace(/%-d|%[dbBYaAHM]/g, (t) => {
    switch (t) {
      case "%-d": return String(d.getDate());
      case "%d": return pad(d.getDate());
      case "%b": return MONTHS[d.getMonth()].slice(0, 3);
      case "%B": return MONTHS[d.getMonth()];
      case "%Y": return String(d.getFullYear());
      case "%a": return DAYS[d.getDay()].slice(0, 3);
      case "%A": return DAYS[d.getDay()];
      case "%H": return pad(d.getHours());
      case "%M": return pad(d.getMinutes());
      default: return t;
    }
  });
}

export function niceDate(value: string | null | undefined, fmt = "%-d %b %Y"): string {
  return value ? strftime(parseDate(value), fmt) : "—";
}

export function niceTime(value: string | null | undefined): string {
  if (!value) return "—";
  const t = parseDateTime(value);
  const n = Math.round((today().getTime() - parseDate(value).getTime()) / 86_400_000);
  if (n === 0) return "Today, " + strftime(t, "%H:%M");
  if (n === 1) return "Yesterday, " + strftime(t, "%H:%M");
  return strftime(t, "%-d %b, %H:%M");
}

export function until(value: string | null | undefined): string {
  if (!value) return "";
  const n = daysFromToday(value);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/** Indian digit grouping: 340000 -> ₹3,40,000. */
export function inr(value: number | null | undefined): string {
  const n = Math.round(value ?? 0);
  return (n < 0 ? "-₹" : "₹") + Math.abs(n).toLocaleString("en-IN");
}

export function filesize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
