import { PageHeader } from "@/components/ui/page-header";

export default function NotFound() {
  return <PageHeader kicker="Missing" title="That record is not in memory" lede="It was not stored, or the link is wrong." />;
}
