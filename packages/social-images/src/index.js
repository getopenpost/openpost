import { docsPageCatalog } from "./docs-catalog.js";
import { docsRouteFromPage } from "./docs-route.js";

export { docsRouteFromPage } from "./docs-route.js";

export const marketingSiteUrl = "https://openpost.social";
export const docsSiteUrl = "https://docs.openpost.social";
export const socialRendererVersion = "1";

export function socialImageUrl(entry) {
  const query = new URLSearchParams({
    v: socialRendererVersion,
    id: entry.id,
  });
  return `${marketingSiteUrl}/og?${query}`;
}

const platformNames = [
  ["x", "X"],
  ["mastodon", "Mastodon"],
  ["bluesky", "Bluesky"],
  ["linkedin", "LinkedIn"],
  ["threads", "Threads"],
  ["facebook", "Facebook Pages"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["discord", "Discord"],
];

const comparisonNames = [
  ["buffer", "Buffer"],
  ["hootsuite", "Hootsuite"],
  ["typefully", "Typefully"],
  ["postiz", "Postiz"],
  ["post-bridge", "Post Bridge"],
  ["mixpost", "Mixpost"],
];

const toolPages = [
  {
    slug: "social-media-video-editor",
    name: "Social media video editor",
    title: "Free social media video editor - OpenPost Video Editor",
    description:
      "Record or import footage, edit for four social formats, and export without a watermark.",
  },
  {
    slug: "social-media-image-editor",
    name: "Social media image editor",
    title: "Free social media image editor - OpenPost Image Editor",
    description: "Create posts, carousel pages, Story slides, and thumbnails in your browser.",
  },
  {
    slug: "multi-platform-character-counter",
    name: "Multi-platform character counter",
    title: "Free social media character counter - OpenPost",
    description: `Check one draft against the limits and counting rules for ${platformNames.length} social networks.`,
  },
  {
    slug: "post-preview-generator",
    name: "Post preview generator",
    title: "Free social post preview generator - OpenPost",
    description: "Preview text, links, media, and supported formats before you publish.",
  },
  {
    slug: "thread-splitter",
    name: "Thread splitter",
    title: "Free social media thread splitter - OpenPost",
    description:
      "Split long drafts into clean parts for X, Bluesky, Mastodon, Threads, or LinkedIn.",
  },
  {
    slug: "fediverse-handle-checker",
    name: "Fediverse handle checker",
    title: "Fediverse and Bluesky handle checker - OpenPost",
    description: "Validate a Fediverse or Bluesky handle, then choose whether to run a live check.",
  },
  {
    slug: "linkedin-text-formatter",
    name: "LinkedIn text formatter",
    title: "Accessible LinkedIn post formatter - OpenPost",
    description:
      "Clean up spacing, shorten paragraphs, and check length without using fake Unicode styles.",
  },
  {
    slug: "best-time-to-post-calculator",
    name: "Timezone posting planner",
    title: "Free social posting schedule planner - OpenPost",
    description: "Turn your audience hours and timezone into a weekly posting plan you can reuse.",
  },
];

const staticMarketingEntries = [
  {
    path: "/",
    key: "home",
    title: "OpenPost - The all-in-one content team for solo founders",
    socialTitle: "Turn what you’re building into content. Publish it everywhere.",
    description:
      "OpenPost helps solo founders create, adapt, schedule, and track content from one workspace.",
    label: "The content team for companies of one",
    kind: "home",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "1.0",
  },
  {
    path: "/features",
    key: "features",
    title: "OpenPost features",
    socialTitle: "One system for the whole publishing job.",
    description:
      "See OpenPost composing, scheduling, media, analytics, conversations, teams, automation, and self-hosting with current limits.",
    label: "Product features",
    kind: "workflow",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.9",
  },
  {
    path: "/pricing",
    key: "pricing",
    title: "OpenPost pricing",
    socialTitle: "A content system that grows with your company.",
    description:
      "Compare OpenPost Hosted service plans with clear limits for workspaces, accounts, posts, media, and seats.",
    label: "Hosted service plans",
    kind: "workflow",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.9",
  },
  {
    path: "/platforms",
    key: "platforms",
    title: "Social platforms supported by OpenPost",
    socialTitle: "Publish where your audience already is.",
    description:
      "See formats, account needs, limits, and live-test notes for every platform in OpenPost.",
    label: `${platformNames.length} publishing destinations`,
    kind: "platforms",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.9",
  },
  {
    path: "/compare",
    key: "compare",
    title: "Compare OpenPost with social scheduling tools",
    socialTitle: "Choose the content system that fits your work.",
    description: "Compare OpenPost with established publishing tools using reviewed product facts.",
    label: "Honest comparisons",
    kind: "compare-index",
    agentRepresentation: "static",
    agentDiscovery: { membership: "optional" },
    priority: "0.8",
  },
  {
    path: "/tools",
    key: "tools",
    title: "Free social media tools - OpenPost",
    socialTitle: "Useful social tools. No account required.",
    description: "Preview, write, prepare, edit, and plan social content in your browser.",
    label: "OpenPost free tools",
    kind: "tools-index",
    agentRepresentation: "static",
    agentDiscovery: { membership: "optional" },
    priority: "0.8",
  },
  {
    path: "/faq",
    key: "faq",
    title: "OpenPost FAQ",
    socialTitle: "Know the boundary before you start.",
    description:
      "Answers about OpenPost setup, providers, billing, privacy, publishing failures, and self-hosting.",
    label: "Frequently asked questions",
    kind: "document",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.7",
  },
  {
    path: "/security",
    key: "security",
    title: "Security controls and responsibilities - OpenPost",
    socialTitle: "Keep social account keys inside OpenPost.",
    description:
      "See how OpenPost encrypts account keys, limits tool access, and protects sign-in sessions.",
    label: "Security",
    kind: "security",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.7",
  },
  {
    path: "/trust",
    key: "trust",
    title: "Hosted service trust and data locations - OpenPost",
    socialTitle: "Where Hosted service data is stored and processed.",
    description:
      "The reviewed data locations, service providers, international transfers, and human production-access facts for the Hosted service.",
    label: "Hosted service trust register",
    kind: "security",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.6",
  },
  {
    path: "/self-hosted",
    key: "self-hosted",
    title: "Self-host OpenPost",
    socialTitle: "Run OpenPost on infrastructure you control.",
    description:
      "Review OpenPost self-hosting infrastructure, data, upgrades, backups, provider projects, support, and operator responsibilities.",
    label: "Self-hosted deployment",
    kind: "open-source",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.8",
  },
  {
    path: "/open-source",
    key: "open-source",
    title: "Open source and self-hosting - OpenPost",
    socialTitle: "Use the Hosted service. Keep the option to self-host.",
    description: "Run the complete AGPL OpenPost service yourself or use the Hosted service.",
    label: "Open source",
    kind: "open-source",
    agentRepresentation: "static",
    agentDiscovery: { membership: "primary" },
    priority: "0.7",
  },
  {
    path: "/changelog",
    key: "changelog",
    title: "OpenPost changelog",
    socialTitle: "What changed in OpenPost, in plain language.",
    description:
      "Read recent product, publishing, security, OpenPost Image Editor, CLI, and MCP changes.",
    label: "Changelog",
    kind: "document",
    agentRepresentation: "static",
    agentDiscovery: { membership: "unlisted" },
    priority: "0.6",
  },
  {
    path: "/privacy",
    key: "privacy",
    title: "Privacy Policy - OpenPost",
    socialTitle: "OpenPost privacy policy.",
    description:
      "How OpenPost collects, uses, shares, protects, exports, and deletes hosted-service data.",
    label: "Legal",
    kind: "document",
    agentRepresentation: "static",
    agentDiscovery: { membership: "unlisted" },
    priority: "0.4",
  },
  {
    path: "/terms",
    key: "terms",
    title: "Terms of Service - OpenPost",
    socialTitle: "OpenPost terms of service.",
    description:
      "Terms for hosted accounts, plans, connected networks, publishing, and acceptable use.",
    label: "Legal",
    kind: "document",
    agentRepresentation: "static",
    agentDiscovery: { membership: "unlisted" },
    priority: "0.4",
  },
  {
    path: "/refunds",
    key: "refunds",
    title: "Refund Policy - OpenPost",
    socialTitle: "OpenPost refund policy.",
    description:
      "How to cancel, request a refund, report a billing error, and use mandatory consumer rights.",
    label: "Legal",
    kind: "document",
    agentRepresentation: "static",
    agentDiscovery: { membership: "unlisted" },
    priority: "0.4",
  },
];

const platformEntries = platformNames.map(([slug, name]) => ({
  path: `/platforms/${slug}`,
  key: `platform-${slug}`,
  title: `${name} publishing support - OpenPost`,
  socialTitle: `${name}, from the same content system.`,
  description: `See how OpenPost handles ${name} formats, setup needs, limits, and live-test notes.`,
  label: "Destination guide",
  kind: "platform",
  agentRepresentation: "platform",
  agentDiscovery: { membership: "optional", section: "platforms" },
  subject: name,
  platform: slug,
  priority: "0.7",
}));

const comparisonEntries = comparisonNames.map(([slug, name]) => ({
  path: `/compare/${slug}`,
  key: `compare-${slug}`,
  title: `OpenPost vs ${name}: an honest comparison`,
  socialTitle: `OpenPost vs ${name}.`,
  description:
    "Compare publishing workflow, automation, hosting, product scope, and current pricing models.",
  label: "Reviewed comparison",
  kind: "comparison",
  agentRepresentation: "comparison",
  agentDiscovery: { membership: "optional", section: "comparisons" },
  subject: name,
  priority: "0.6",
}));

const toolEntries = toolPages.map((tool) => ({
  path: `/tools/${tool.slug}`,
  key: `tool-${tool.slug}`,
  title: tool.title,
  socialTitle: tool.name,
  description: tool.description,
  label: "Free browser tool",
  kind: "tool",
  agentRepresentation: "tool",
  agentDiscovery: { membership: "optional", section: "tools" },
  subject: tool.name,
  priority: "0.6",
}));

export const marketingRouteManifest = Object.freeze(
  [...staticMarketingEntries, ...platformEntries, ...comparisonEntries, ...toolEntries].map(
    (entry) => {
      const resolved = {
        ...entry,
        id: `marketing:${entry.key}`,
        canonical: canonicalMarketingUrl(entry.path),
        imageAlt: `${entry.socialTitle} OpenPost social preview.`,
      };
      return { ...resolved, imageUrl: socialImageUrl(resolved) };
    },
  ),
);

export const marketingSocialEntries = marketingRouteManifest;

const prerenderSections = new Set(["/platforms", "/compare", "/tools"]);

export function marketingPrerenderEntries(section) {
  const normalizedSection = normalizeMarketingPath(section);
  if (!prerenderSections.has(normalizedSection)) {
    throw new Error(`Unknown marketing prerender section: ${section}`);
  }
  const prefix = `${normalizedSection}/`;
  return marketingRouteManifest.flatMap((entry) => {
    if (!entry.path.startsWith(prefix)) return [];
    const slug = entry.path.slice(prefix.length);
    return slug && !slug.includes("/") ? [{ slug }] : [];
  });
}

const marketingByPath = new Map(marketingSocialEntries.map((entry) => [entry.path, entry]));

export function normalizeMarketingPath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return `/${pathname
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+|\/+$/g, "")}`;
}

export function canonicalMarketingUrl(pathname) {
  const path = normalizeMarketingPath(pathname);
  return path === "/" ? marketingSiteUrl : `${marketingSiteUrl}${path}`;
}

export function marketingAgentMarkdownUrl(entry) {
  if (!entry.agentDiscovery) return undefined;
  return entry.path === "/" ? `${marketingSiteUrl}/index.md` : `${entry.canonical}.md`;
}

export function resolveMarketingSocial(pathname) {
  const path = normalizeMarketingPath(pathname);
  const exact = marketingByPath.get(path);
  if (exact) return exact;

  const fallback = marketingByPath.get("/");
  const resolved = {
    ...fallback,
    path,
    canonical: canonicalMarketingUrl(path),
  };
  return { ...resolved, imageUrl: socialImageUrl(resolved) };
}

export function docsImageKey(page) {
  const route = docsRouteFromPage(page).replace(/^\/+|\/+$/g, "");
  return route ? route.replaceAll("/", "--") : "home";
}

export function docsSectionForPage(page) {
  const route = docsRouteFromPage(page);
  if (route === "/") return "OpenPost docs";
  if (route.startsWith("/usage/") || route.startsWith("/guide/what-is")) {
    return "User guide";
  }
  if (route.startsWith("/providers/")) return "Provider guide";
  if (route.startsWith("/installation/")) return "Installation";
  if (route.startsWith("/configuration/")) return "Configuration";
  if (route.startsWith("/operations/")) return "Operations";
  if (route.startsWith("/self-hosting/") || route === "/guide/why-selfhost") {
    return "Self-hosting";
  }
  if (route.startsWith("/cli/")) return "CLI guide";
  if (route.startsWith("/mcp/")) return "MCP guide";
  if (route.startsWith("/development/")) return "Developer docs";
  if (route.startsWith("/reference/")) return "Reference";
  return "OpenPost docs";
}

export function docsDescriptionForPage(page) {
  const section = docsSectionForPage(page);
  const descriptions = {
    "OpenPost docs":
      "Learn how to create, adapt, schedule, publish, and track content with OpenPost.",
    "User guide":
      "Use the OpenPost app to manage drafts, destinations, media, schedules, results, and replies.",
    "Provider guide":
      "Check provider setup, supported formats, limits, permissions, and live-test requirements.",
    Installation: "Install OpenPost with the deployment path that fits your server or device.",
    Configuration:
      "Configure OpenPost storage, databases, URLs, providers, updates, and production settings.",
    Operations:
      "Operate OpenPost with clear health checks, logs, backups, upgrades, and recovery steps.",
    "Self-hosting": "Run OpenPost as one Go service with SQLite and local media by default.",
    "CLI guide": "Use OpenPost from a terminal, script, scheduled job, or CI workflow.",
    "MCP guide": "Connect AI tools to OpenPost without sharing social account credentials.",
    "Developer docs":
      "Understand the OpenPost architecture, API, tests, adapters, jobs, and release workflow.",
    Reference: "Look up OpenPost API, CLI, configuration, and deployment details.",
  };
  return descriptions[section];
}

export function resolveDocsSocial({ page, title, description }) {
  const route = docsRouteFromPage(page);
  const cleanTitle = title?.trim() || "OpenPost documentation";
  const cleanDescription = description?.trim() || docsDescriptionForPage(page);
  const key = docsImageKey(page);

  const resolved = {
    id: `docs:${key}`,
    path: route,
    key,
    title: `${cleanTitle} | OpenPost Docs`,
    socialTitle: cleanTitle,
    description: cleanDescription,
    label: docsSectionForPage(page),
    kind: "docs",
    canonical: route === "/" ? docsSiteUrl : `${docsSiteUrl}${route}`,
    imageAlt: `${cleanTitle}. OpenPost documentation preview.`,
  };
  return { ...resolved, imageUrl: socialImageUrl(resolved) };
}

export const docsSocialEntries = Object.freeze(
  docsPageCatalog.map((entry) => ({
    ...resolveDocsSocial(entry),
    page: entry.page,
    route: entry.route,
    agentRepresentation: entry.agentRepresentation,
    agentDiscovery: entry.agentDiscovery,
    agentCorpus: entry.agentCorpus,
  })),
);

const socialById = new Map(
  [...marketingSocialEntries, ...docsSocialEntries].map((entry) => [entry.id, entry]),
);

export function resolveSocialImageEntry(id) {
  return socialById.get(id) || socialById.get("marketing:home");
}
