export type SocialImageKind =
  | "home"
  | "workflow"
  | "platforms"
  | "platform"
  | "tools-index"
  | "tool"
  | "security"
  | "self-hosting"
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
    section?: "platforms" | "tools";
  };
}

export interface MarketingRouteEntry extends SocialEntry {
  priority: string;
  agentRepresentation: "static" | "platform" | "tool";
  agentDiscovery: {
    membership: "primary" | "optional" | "unlisted";
    section?: "platforms" | "tools";
  };
}

export type DocumentationDiscoverySection =
  | "user-guide"
  | "providers"
  | "cli"
  | "mcp"
  | "installation"
  | "self-hosting"
  | "configuration"
  | "operations"
  | "api"
  | "development";

export interface DocumentationPageEntry extends SocialEntry {
  page: string;
  route: string;
  agentRepresentation:
    | {
        membership: "ordinary";
        sizeException?: { reviewed: true; reason: string };
      }
    | { membership: "special"; reason: string };
  agentDiscovery:
    | { membership: "primary"; section?: DocumentationDiscoverySection }
    | { membership: "optional" | "unlisted"; section?: DocumentationDiscoverySection };
  agentCorpus:
    | { membership: "included"; section: DocumentationDiscoverySection }
    | { membership: "excluded"; reason: string };
}

export const marketingSiteUrl: "https://openpo.st";
export const docsBasePath: "/docs";
export const docsSiteUrl: "https://openpo.st/docs";
export function docsPath(pathname?: string): string;
export function docsSocialImageKey(route: string): string;
export function docsSocialImageUrlForRoute(route: string): string;
export const marketingRouteManifest: readonly MarketingRouteEntry[];
export const marketingSocialEntries: readonly MarketingRouteEntry[];
export const docsSocialEntries: readonly DocumentationPageEntry[];

export function normalizeMarketingPath(pathname: string): string;
export function canonicalMarketingUrl(pathname: string): string;
export function marketingAgentMarkdownUrl(entry: MarketingRouteEntry): string | undefined;
export function resolveMarketingSocial(pathname: string): MarketingRouteEntry;
export function marketingPrerenderEntries(
  section: "/platforms" | "/tools" | "/guides",
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

export interface MarketingGuide {
  slug: string;
  question: string;
  socialDescription: string;
  answer: string;
  sections: { title: string; text: string; items?: string[] }[];
  sources: { label: string; href: string }[];
  next: { label: string; href: string };
}
export const marketingGuides: MarketingGuide[];
export type ImageToolFormat = "png" | "jpeg" | "webp";
export type ImageConversionSlug =
  | "png-to-jpg"
  | "png-to-webp"
  | "jpg-to-png"
  | "jpg-to-webp"
  | "webp-to-png"
  | "webp-to-jpg";
export type MediaToolSlug =
  | ImageConversionSlug
  | "background-remover"
  | "image-color-picker"
  | "paste-image"
  | "logo-maker"
  | "quick-cut"
  | "image-converter";
export interface MediaTool {
  slug: MediaToolSlug;
  name: string;
  title: string;
  description: string;
  category: "Images" | "Video" | "Convert";
}
export interface ImageConversion extends MediaTool {
  slug: ImageConversionSlug;
  input: ImageToolFormat;
  output: ImageToolFormat;
}
export const mediaTools: readonly MediaTool[];
export const imageConversions: readonly ImageConversion[];
export const imageFormats: readonly {
  id: ImageToolFormat;
  name: string;
  extension: string;
  mime: string;
}[];
