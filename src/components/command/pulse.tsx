import Link from "next/link";
import { DataMark } from "@/components/ui/data-mark";
import { Status } from "@/components/ui/status";
import type { PulseCard } from "@/lib/db/types";

export function Pulse({ cards }: { cards: PulseCard[] }) {
  return (
    <div className="pulse-grid">
      {cards.map((card) => (
        <Link className="card" key={card.organisation.id} href={`/businesses/${card.organisation.id}`}>
          <div className="card-top">
            <span className="kicker">{card.organisation.type}</span>
            {card.organisation.pulse_status ? <Status value={card.organisation.pulse_status} /> : null}
          </div>
          <h3>{card.organisation.name}</h3>
          {card.metrics.length > 0 ? (
            <div className="metrics">
              {card.metrics.map((metric) => (
                <div className="metric" key={metric.id}>
                  <span>
                    {metric.label} <DataMark status={metric.data_status === "demo" ? "demo" : metric.data_status === "stale" ? "stale" : null} />
                  </span>
                  <b>{metric.value}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="quiet">No performance figures are stored.</p>
          )}
          {card.organisation.interpretation && card.organisation.data_status !== "demo" ? (
            <p className="interpretation">{card.organisation.interpretation}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
