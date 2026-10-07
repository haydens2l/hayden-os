import type { Metadata } from "next";
import Link from "next/link";
import { recordModelCapability, replaceProductionRule } from "@/lib/actions";
import { activeRules } from "@/lib/factory/defaults";
import { listModelProfiles } from "@/lib/factory/models";
import { listPacks } from "@/lib/factory/store";
import { creativeQueue, nextStep } from "@/lib/content/workflow";
import { CAPABILITY_FIELDS, PRODUCTION_TYPES, productionTypeLabel, statusLabel } from "@/lib/factory/types";
import { HowLink } from "@/components/shell/how-link";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Production" };

const BUCKETS: Array<[string, string[]]> = [
  ["Awaiting approval", ["draft", "needs_review"]],
  ["Ready to produce", ["approved"]],
  ["In production", ["assigned", "in_production"]],
  ["Blocked", ["blocked"]],
  ["Ready for review", ["ready_for_review"]],
  ["Complete", ["complete"]],
];

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; owner?: string; format?: string; model?: string; status?: string; project?: string }>;
}) {
  const filters = await searchParams;
  const db = getDb();
  const packs = listPacks(db, {
    brand: filters.brand,
    owner: filters.owner,
    productionType: filters.format,
    model: filters.model,
    status: filters.status,
    project: filters.project,
  });
  const profiles = listModelProfiles(db);
  const rules = activeRules(db, {});
  const brands = [...new Set(packs.map((pack) => pack.brand).filter(Boolean))] as string[];
  const queue = creativeQueue(db);

  return (
    <>
      <header className="page-header">
        <p className="kicker">Content</p>
        <h1>Production</h1>
        <p className="lede">Start with the idea. Lock the script and the look before a production pack exists.</p>
        <p className="row-actions">
          <Link href="/production/new">Create content</Link>
          <Link href="/production/styles">Style library</Link>
          <Link href="/production/usage">Usage</Link>
          <Link href="/production/gpu-test">GPU test</Link>
        </p>
        <HowLink href="/help#content" />
      </header>
      <section>
        <h2>Needs your creative decision</h2>
        {queue.length === 0 ? <p className="quiet">Nothing creative is waiting.</p> : null}
        {queue.map((item) => {
          const step = nextStep(item.stage);
          return (
            <p key={item.id}>
              <Link href={`/production/content/${item.id}`}>{item.brand} — {item.title}</Link>
              <span className="quiet"> {item.stage.replaceAll("_", " ")}. {step.action}.</span>
            </p>
          );
        })}
      </section>
      <h2>Legacy production packs</h2>
      <form className="row-actions" action="/production" method="get">
        <input name="brand" defaultValue={filters.brand ?? ""} placeholder="Brand" />
        <select name="owner" className="delegate-select" defaultValue={filters.owner ?? ""}>
          <option value="">Owner</option>
          <option value="lily">Lily</option>
          <option value="danny">Danny</option>
        </select>
        <select name="format" className="delegate-select" defaultValue={filters.format ?? ""}>
          <option value="">Format</option>
          {PRODUCTION_TYPES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select name="model" className="delegate-select" defaultValue={filters.model ?? ""}>
          <option value="">Model</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <select name="status" className="delegate-select" defaultValue={filters.status ?? ""}>
          <option value="">Status</option>
          {BUCKETS.flatMap(([, statuses]) => statuses).map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <input name="project" defaultValue={filters.project ?? ""} placeholder="Project id" />
        <button className="text-button" type="submit">
          Filter
        </button>
      </form>
      <div className="board">
        {BUCKETS.map(([label, statuses]) => (
          <section key={label}>
            <p className="column-label">{label}</p>
            {packs
              .filter((pack) => statuses.includes(pack.status))
              .map((pack) => (
                <article className="card project-card" key={pack.id}>
                  <p className="kicker">
                    {statusLabel(pack.status)} · v{pack.version} · {productionTypeLabel(pack.production_type)}
                  </p>
                  <h3>
                    <Link href={`/production/${pack.id}`}>{pack.brand ?? "Unassigned"}</Link>
                  </h3>
                  <p>{pack.production_owner ? `Owner ${pack.production_owner}` : "Unassigned"}</p>
                  <p>Continuity {pack.continuity_status === "pass" ? "pass" : "issues found"}</p>
                </article>
              ))}
          </section>
        ))}
      </div>
      <section className="section">
        <h2>Model profiles</h2>
        <p className="quiet">Unverified capabilities stay UNKNOWN. A profile name is not proof the model can do the job.</p>
        <div className="stack">
          {profiles.map((profile) => (
            <article className="record" key={profile.id}>
              <h3>{profile.name}</h3>
              <p>
                Durations {profile.allowed_durations}. Start and end frames {profile.start_end_frames}. Audio {profile.audio_support}. Dialogue{" "}
                {profile.dialogue_support}. Aspect ratios {profile.aspect_ratios}.
              </p>
              <form action={recordModelCapability} className="row-actions">
                <input type="hidden" name="profileId" value={profile.id} />
                <input type="hidden" name="next" value="/production" />
                <select name="field" className="delegate-select" defaultValue="audio_support">
                  {CAPABILITY_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {field.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <input name="value" placeholder="Verified value only" />
                <button className="text-button" type="submit">
                  Record verified capability
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Production rules</h2>
        <p className="quiet">Founder preferences. A newer rule replaces the old one. Nothing here is permanent.</p>
        {brands.length === 0 ? null : <p className="quiet">Brands in view: {brands.join(", ")}.</p>}
        <div className="stack">
          {rules.map((rule) => (
            <article className="record" key={rule.id}>
              <p className="kicker">{rule.scope}</p>
              <h3>{rule.title}</h3>
              <p>{rule.body}</p>
              <form action={replaceProductionRule} className="stack">
                <input type="hidden" name="ruleId" value={rule.id} />
                <input type="hidden" name="next" value="/production" />
                <textarea name="body" rows={3} defaultValue={rule.body} />
                <button className="text-button" type="submit">
                  Replace rule
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
