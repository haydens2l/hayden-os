export function Status({ value }: { value: string | null | undefined }) {
  const label =
    value === "action_required" ? "Action required" : value === "watch" ? "Watch" : value === "healthy" ? "Healthy" : "No status";
  return <span className={`status status-${value ?? "none"}`}>{label}</span>;
}
