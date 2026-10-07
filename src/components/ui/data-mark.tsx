const LABELS: Record<string, string> = {
  demo: "Demo — not a live figure",
  manual: "Manual",
  imported: "Imported",
  stale: "Stale",
  live: "Live",
};

export function DataMark({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <span className={`data-mark data-${status}`}>{LABELS[status] ?? status}</span>;
}
