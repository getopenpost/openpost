import { docsSiteUrl, docsSocialEntries, resolveDocsSocial } from "@openpost/social-images";
import { defineConfig } from "vitepress";
import { postHogSourceMaps } from "../../scripts/posthog-source-maps";

// Default to root-path hosting so custom-domain deployments work without extra config.
// Repository-path deployments (for example, GitHub Pages at /openpost/) should set OPENPOST_DOCS_BASE explicitly.
const docsBase = process.env.OPENPOST_DOCS_BASE?.trim() || "/";
const sourceMaps = postHogSourceMaps("docs");

const userDocsSidebar = [
  {
    text: "Start Here",
    collapsed: false,
    items: [
      { text: "What is OpenPost?", link: "/guide/what-is-openpost" },
      { text: "Quickstart", link: "/guide/quickstart" },
      { text: "Concepts", link: "/guide/concepts" },
    ],
  },
  {
    text: "Web App",
    collapsed: false,
    items: [
      { text: "Overview", link: "/usage/" },
      {
        text: "Agent-Assisted Publishing",
        link: "/usage/agent-assisted-publishing",
      },
      { text: "Workspaces", link: "/usage/workspaces" },
      { text: "Settings", link: "/usage/settings" },
      { text: "Account Security", link: "/usage/account-security" },
      { text: "Accounts", link: "/usage/accounts" },
      { text: "Composing Posts", link: "/usage/composing-posts" },
      { text: "Destination Options", link: "/usage/destination-options" },
      { text: "Threads", link: "/usage/threads" },
      { text: "Scheduling", link: "/usage/scheduling" },
      { text: "Auto Reposts", link: "/usage/auto-reposts" },
      { text: "Analytics", link: "/usage/analytics" },
      { text: "Grow", link: "/usage/grow" },
      { text: "Communications", link: "/usage/communications" },
      { text: "Media Library", link: "/usage/media-library" },
      { text: "Image Editor", link: "/usage/image-editor" },
      { text: "Video Editor", link: "/usage/video-editor" },
      { text: "Quick Cut", link: "/usage/quick-cut" },
      { text: "Recorder", link: "/usage/recording" },
    ],
  },
  {
    text: "CLI",
    collapsed: false,
    items: [
      { text: "Overview", link: "/cli/" },
      { text: "Installation", link: "/cli/installation" },
      { text: "Authentication", link: "/cli/authentication" },
      { text: "Posting", link: "/cli/posting" },
      { text: "Automation", link: "/cli/automation" },
    ],
  },
  {
    text: "MCP",
    collapsed: false,
    items: [{ text: "Assistant Scheduling", link: "/mcp/" }],
  },
  {
    text: "Apps",
    collapsed: false,
    items: [{ text: "Android App", link: "/installation/android" }],
  },
  {
    text: "Reference",
    collapsed: false,
    items: [
      { text: "CLI Command Reference", link: "/reference/cli" },
      { text: "Product Surface Parity", link: "/reference/surface-parity" },
    ],
  },
];

const selfHostingSidebar = [
  {
    text: "Overview",
    collapsed: false,
    items: [{ text: "Start Here", link: "/self-hosting/" }],
  },
  {
    text: "Install",
    collapsed: false,
    items: [
      { text: "Docker Compose", link: "/installation/docker-compose" },
      { text: "Single Binary", link: "/installation/binary" },
      { text: "Nix Module", link: "/installation/nix-module" },
      { text: "Reverse Proxy", link: "/installation/reverse-proxy" },
      { text: "Build From Source", link: "/installation/build-from-source" },
      { text: "Docker Run", link: "/installation/docker-run" },
    ],
  },
  {
    text: "Configure",
    collapsed: false,
    items: [
      { text: "Overview", link: "/configuration/" },
      {
        text: "Environment Variables",
        link: "/configuration/environment-variables",
      },
      { text: "Product Telemetry", link: "/configuration/telemetry" },
      {
        text: "Provider Applications",
        link: "/configuration/provider-applications",
      },
      { text: "Custom Connectors", link: "/configuration/custom-connectors" },
      { text: "Update Status", link: "/configuration/update-status" },
      { text: "User Feedback", link: "/configuration/feedback" },
      { text: "Database", link: "/configuration/database" },
      { text: "Media Storage", link: "/configuration/media-storage" },
      { text: "CORS and URLs", link: "/configuration/cors-and-urls" },
      {
        text: "Invitation Delivery Callbacks",
        link: "/configuration/invitation-delivery-callbacks",
      },
      {
        text: "Production Checklist",
        link: "/configuration/production-checklist",
      },
    ],
  },
  {
    text: "Providers",
    collapsed: false,
    items: [
      { text: "Overview", link: "/providers/" },
      { text: "Provider Troubleshooting", link: "/providers/troubleshooting" },
      { text: "X", link: "/providers/x" },
      { text: "Mastodon", link: "/providers/mastodon" },
      { text: "Bluesky", link: "/providers/bluesky" },
      { text: "LinkedIn", link: "/providers/linkedin" },
      { text: "Threads", link: "/providers/threads" },
      { text: "Facebook", link: "/providers/facebook" },
      { text: "Instagram", link: "/providers/instagram" },
      { text: "TikTok", link: "/providers/tiktok" },
      { text: "YouTube", link: "/providers/youtube" },
      { text: "Discord Webhooks", link: "/providers/discord" },
    ],
  },
  {
    text: "Operate",
    collapsed: false,
    items: [
      { text: "Backups", link: "/operations/backups" },
      { text: "Container Image", link: "/operations/container-image" },
      { text: "Health Checks", link: "/operations/health-checks" },
      { text: "Logs", link: "/operations/logs" },
      { text: "Upgrades", link: "/operations/upgrades" },
      { text: "Troubleshooting", link: "/operations/troubleshooting" },
      { text: "Provider Launch Matrix", link: "/operations/provider-launch-matrix" },
    ],
  },
  {
    text: "Reference",
    collapsed: false,
    items: [
      { text: "Callback URLs", link: "/reference/callback-urls" },
    ],
  },
];

const developmentSidebar = [
  {
    text: "Development",
    collapsed: false,
    items: [
      { text: "Overview", link: "/development/" },
      { text: "Setup", link: "/development/setup" },
      { text: "Architecture", link: "/development/architecture" },
      { text: "API Reference", link: "/development/api-reference" },
      { text: "API Tokens", link: "/development/api-tokens" },
      { text: "API Compatibility", link: "/development/compatibility-policy" },
      {
        text: "Post Migration",
        link: "/development/post-publication-migration",
      },
      { text: "Frontend", link: "/development/frontend" },
      { text: "Backend", link: "/development/backend" },
      { text: "Platform Adapters", link: "/development/platform-adapters" },
      {
        text: "Connector Protocol",
        link: "/development/connector-protocol",
      },
      { text: "Background Jobs", link: "/development/background-jobs" },
      { text: "Analytics Architecture", link: "/development/analytics" },
      { text: "Testing", link: "/development/testing" },
      { text: "Releases and Versioning", link: "/development/releases" },
      { text: "MCP And ChatGPT App", link: "/development/mcp" },
      { text: "Billing And Usage", link: "/development/billing-and-usage" },
      {
        text: "Production Architecture",
        link: "/development/production-readiness",
      },
      { text: "Third-Party Notices", link: "/development/third-party-notices" },
      { text: "Contributing", link: "/development/contributing" },
    ],
  },
];

export default defineConfig({
  vite: {
    plugins: sourceMaps.plugins,
    build: { sourcemap: sourceMaps.enabled ? "hidden" : false },
  },
  title: "OpenPost",
  description:
    "Draft, adapt, schedule, and automate social posts with the OpenPost Hosted service or the same self-hosted product.",
  sitemap: { hostname: docsSiteUrl },
  base: docsBase,
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: `${docsBase}assets/brand/icon.svg` }]],
  transformPageData(pageData) {
    const entry = docsSocialEntries.find((candidate) => candidate.page === pageData.relativePath);
    if (entry && typeof pageData.frontmatter.description !== "string") {
      pageData.frontmatter.description = entry.description;
      pageData.description = entry.description;
    }
  },
  transformHead({ page, pageData }) {
    const frontmatterDescription = pageData.frontmatter.description;
    const social = resolveDocsSocial({
      page,
      title: pageData.title,
      description: typeof frontmatterDescription === "string" ? frontmatterDescription : undefined,
    });
    const image = social.imageUrl;
    const agentPage = docsSocialEntries.find((entry) => entry.page === page);
    const agentDiscovery = [
      ...(agentPage?.agentRepresentation.membership === "ordinary"
        ? [
            [
              "link",
              {
                rel: "alternate",
                type: "text/markdown",
                href: new URL(agentPage.page, `${docsSiteUrl}/`).href,
              },
            ],
          ]
        : []),
      [
        "link",
        {
          rel: "alternate",
          type: "text/plain",
          href: `${docsSiteUrl}/llms.txt`,
          title: "llms.txt",
        },
      ],
      [
        "link",
        {
          rel: "alternate",
          type: "text/plain",
          href: `${docsSiteUrl}/llms-full.txt`,
          title: "OpenPost documentation full corpus",
        },
      ],
    ];
    return [
      ["link", { rel: "canonical", href: social.canonical }],
      ...agentDiscovery,
      ["meta", { property: "og:site_name", content: "OpenPost Docs" }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:title", content: social.socialTitle }],
      ["meta", { property: "og:description", content: social.description }],
      ["meta", { property: "og:url", content: social.canonical }],
      ["meta", { property: "og:image", content: image }],
      ["meta", { property: "og:image:secure_url", content: image }],
      ["meta", { property: "og:image:type", content: "image/png" }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      ["meta", { property: "og:image:alt", content: social.imageAlt }],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
      ["meta", { name: "twitter:title", content: social.socialTitle }],
      ["meta", { name: "twitter:description", content: social.description }],
      ["meta", { name: "twitter:image", content: image }],
      ["meta", { name: "twitter:image:alt", content: social.imageAlt }],
    ];
  },
  themeConfig: {
    logo: "/assets/brand/icon.svg",
    nav: [
      { text: "Home", link: "https://openpost.social" },
      { text: "User Docs", link: "/usage/" },
      { text: "CLI", link: "/cli/" },
      { text: "MCP", link: "/mcp/" },
      { text: "Self-Hosting", link: "/self-hosting/" },
      { text: "Providers", link: "/providers/" },
      { text: "Developer Docs", link: "/development/" },
      { text: "Community", link: "https://discord.gg/u2QwukmY4W" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/getopenpost/openpost" },
      { icon: "discord", link: "https://discord.gg/u2QwukmY4W" },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/getopenpost/openpost/edit/main/docs-site/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Open source under AGPL-3.0-only.",
      copyright: "Copyright © 2026 OpenPost Contributors",
    },
    sidebar: {
      "/installation/android": userDocsSidebar,
      "/reference/cli": userDocsSidebar,
      "/guide/what-is-openpost": userDocsSidebar,
      "/guide/quickstart": userDocsSidebar,
      "/guide/concepts": userDocsSidebar,
      "/usage/": userDocsSidebar,
      "/cli/": userDocsSidebar,
      "/mcp/": userDocsSidebar,
      "/self-hosting/": selfHostingSidebar,
      "/installation/": selfHostingSidebar,
      "/configuration/": selfHostingSidebar,
      "/providers/": selfHostingSidebar,
      "/operations/": selfHostingSidebar,
      "/development/": developmentSidebar,
      "/": userDocsSidebar,
    },
  },
});
