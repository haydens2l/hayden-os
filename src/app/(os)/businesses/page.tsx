import type { Metadata } from "next";
import { Pulse } from "@/components/command/pulse";
import { PageHeader } from "@/components/ui/page-header";
import { listPulse } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Businesses" };

export default function BusinessesPage() {
  return (
    <>
      <PageHeader
        kicker="Businesses"
        title="Business pulse"
        lede="Every active organisation in memory. Archive one and it leaves this list. Nothing here is hardcoded to a brand name."
      />
      <Pulse cards={listPulse()} />
    </>
  );
}
