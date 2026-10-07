import { DataMark } from "@/components/ui/data-mark";
import type { Finding } from "@/lib/db/types";

export function Briefing({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <p className="quiet">No findings are stored. Nothing here is a live result.</p>;
  return (
    <ol className="briefing">
      {findings.map((finding) => (
        <li key={finding.id}>
          <p className="kicker">
            {finding.category ?? "Signal"}
            {finding.requires_hayden ? " · Needs you" : " · With the team"}
            {finding.data_status === "demo" ? " · Demo" : ""}
          </p>
          <DataMark status={finding.data_status === "demo" ? "demo" : null} />
          <h3>{finding.what_happened}</h3>
          <p>{finding.why_it_matters}</p>
          <p>{finding.recommended_response}</p>
          <p className="who">
            {finding.responsible ?? "Unassigned"}
            {finding.organisation_name ? ` · ${finding.organisation_name}` : ""}
            {finding.source === "seed" ? " · Snapshot, not a live agent" : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
