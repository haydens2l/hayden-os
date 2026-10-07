export function secondsBetween(start: string | null, end: string | null, now = Date.now()) {
  if (!start) return null;
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / 1000;
}

export function usdForSeconds(hourlyUsd: number | null, seconds: number | null) {
  if (hourlyUsd == null || seconds == null) return null;
  if (!Number.isFinite(hourlyUsd) || !Number.isFinite(seconds) || hourlyUsd < 0 || seconds < 0) return null;
  return hourlyUsd * (seconds / 3600);
}

export function formatUsd(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  if (value === 0) return "$0.00";
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatClock(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Unknown";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes < 1) return `${remain} seconds`;
  return `${minutes} min ${remain} sec`;
}

export function perApprovedSecond(infrastructureUsd: number | null, approvedSeconds: number) {
  if (infrastructureUsd == null || approvedSeconds <= 0) return null;
  return infrastructureUsd / approvedSeconds;
}
