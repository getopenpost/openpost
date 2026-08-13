export type SocialImageKind =
  | "home"
  | "workflow"
  | "platforms"
  | "platform"
  | "compare-index"
  | "comparison"
  | "tools-index"
  | "tool"
  | "security"
  | "open-source"
  | "document"
  | "docs";

export interface SocialEntry {
  id: string;
  path: string;
  key: string;
  title: string;
  socialTitle: string;
  description: string;
  label: string;
  kind: SocialImageKind;
  canonical: string;
  imageUrl: string;
  imageAlt: string;
  priority?: string;
  subject?: string;
  platform?: string;
  agentDiscovery?: {
    membership: "primary" | "optional" | "unlisted";
    section?: "platforms" | "comparisons" | "tools";
  };
}

export interface MarketingRouteEntry extends SocialEntry {
  priority: string;
  agentRepresentation: "static" | "platform" | "comparison" | "tool";
  agentDiscovery: {
    membership: "primary" | "optional" | "unlisted";
    section?: "platforms" | "comparisons" | "tools";
  };
}

export const marketingSiteUrl: "https://openpost.social";
export const docsSiteUrl: "https://docs.openpost.social";
export const socialRendererVersion: string;
export const marketingRouteManifest: readonly MarketingRouteEntry[];
export const marketingSocialEntries: readonly MarketingRouteEntry[];
export const docsSocialEntries: readonly SocialEntry[];

export function socialImageUrl(entry: Pick<SocialEntry, "id">): string;
export function resolveSocialImageEntry(id: string): SocialEntry;
export function normalizeMarketingPath(pathname: string): string;
export function canonicalMarketingUrl(pathname: string): string;
export function marketingAgentMarkdownUrl(entry: MarketingRouteEntry): string | undefined;
export function resolveMarketingSocial(pathname: string): MarketingRouteEntry;
export function marketingPrerenderEntries(
  section: "/platforms" | "/compare" | "/tools",
): { slug: string }[];
export function docsRouteFromPage(page: string): string;
export function docsImageKey(page: string): string;
export function docsSectionForPage(page: string): string;
export function docsDescriptionForPage(page: string): string;
export function resolveDocsSocial(input: {
  page: string;
  title?: string;
  description?: string;
}): SocialEntry;
