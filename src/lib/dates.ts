/** Inclusive Brisbane start day through exclusive Brisbane end day, as UTC instants. Brisbane is UTC+10. */
export function brisbaneRange(startDay: string, endDay: string): { start: string; end: string } {
  const instant = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date) - 10 * 60 * 60 * 1000).toISOString();
  };
  return { start: instant(startDay), end: instant(endDay) };
}

export function brisbaneWeekStart(offsetWeeks = 0): string {
  const [year, month, day] = brisbaneToday().split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const fromMonday = weekday === 0 ? -6 : 1 - weekday;
  return brisbaneToday(fromMonday + offsetWeeks * 7);
}

export function brisbaneToday(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = parts.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

export function formatLongDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "No update";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatShortDate(iso);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "Australia/Brisbane",
  }).format(date);
}
