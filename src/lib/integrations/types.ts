export const INTEGRATION_SLUGS = [
  "google-drive",
  "google-calendar",
  "meta-ads",
  "crm",
  "aircall",
  "gohighlevel",
  "metricool",
  "accounting",
  "web-research",
  "media-generation",
] as const;

export type IntegrationSlug = (typeof INTEGRATION_SLUGS)[number];

export type IntegrationStatus = "disconnected" | "connected" | "error";

/**
 * Connectors implement this later. Milestone 1 only stores the seat
 * and refuses to pretend a source is live.
 */
export interface IntegrationAdapter {
  slug: IntegrationSlug;
  status(): Promise<IntegrationStatus>;
}
