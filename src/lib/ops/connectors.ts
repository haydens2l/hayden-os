import type Database from "better-sqlite3";
import { getConnection } from "@/lib/integrations/connections";

export function connectorStatus(db: Database.Database) {
  const aircall = getConnection(db, "aircall");
  const ghl = getConnection(db, "gohighlevel");
  return [
    {
      id: "gohighlevel",
      name: "GoHighLevel",
      connected: ghl.status === "connected",
      href: "/settings/integrations/gohighlevel",
      reason: ghl.status === "connected" ? ghl.lastSummary || `${ghl.accountLabel ?? "GoHighLevel"} is connected. Read-only.` : ghl.lastError || "Not connected. Add the private token in Settings and choose the business.",
    },
    {
      id: "aircall",
      name: "Aircall",
      connected: aircall.status === "connected",
      href: "/settings/integrations/aircall",
      reason: aircall.status === "connected" ? aircall.lastSummary || "Aircall is connected. Calls only." : aircall.lastError || "Not connected. Add the API ID and token in Settings and choose the business.",
    },
    { id: "hubspot", name: "HubSpot", connected: false, href: null, reason: "Not connected." },
    { id: "meta", name: "Meta", connected: false, href: null, reason: "Not connected. Ad results are not being pulled." },
    { id: "google-sheets", name: "Google Sheets", connected: false, href: null, reason: "Not connected. A sheet can be exported to CSV and imported until then." },
  ];
}
