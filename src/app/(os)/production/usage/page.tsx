import type { Metadata } from "next";
import Link from "next/link";
import { usageSummary } from "@/lib/executor/assets";
import { IMAGE_PROVIDER_RECORD } from "@/lib/executor/pricing";
import { imageConfig } from "@/lib/executor/providers";
import { assetRoot } from "@/lib/executor/storage";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Production usage" };

export default function UsagePage() {
  const usage = usageSummary(getDb());
  const config = imageConfig();
  return (
    <>
      <header className="page-header">
        <p className="kicker">Content</p>
        <h1>Production usage</h1>
        <p className="lede">Image calls only. A cost is shown when it comes from the published rate card. Otherwise it stays unknown.</p>
        <p className="row-actions">
          <Link href="/production">Production board</Link>
        </p>
      </header>
      <section className="section">
        <p>Provider: {config.configured ? `${config.provider} · ${config.model}` : "Not configured"}</p>
        <p>List price for {IMAGE_PROVIDER_RECORD.model}: ${IMAGE_PROVIDER_RECORD.listPriceUsd.toFixed(2)} per new image. Verified {IMAGE_PROVIDER_RECORD.verifiedOn}. The provider does not return a receipt.</p>
        <p>Files stored: {usage.files}</p>
        <p>Generation records: {usage.generations}</p>
        <p>Failed attempts: {usage.failed}</p>
        <p>List-price total: {usage.knownCount > 0 ? `$${usage.knownUsd.toFixed(2)} across ${usage.knownCount} images` : "None yet"}</p>
        <p>Unknown cost records: {usage.unknownCount}</p>
        <p>Files live in {assetRoot()}.</p>
        {usage.byModel.map((row) => (
          <p key={row.label}>
            {row.label}: {row.count}
          </p>
        ))}
      </section>
    </>
  );
}
