import { defineDocs } from "fumadocs-mdx/macro";
import { loader } from "fumadocs-core/source";
import { openapiPlugin } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";
import { docsPath } from "@openpost/social-images";

const providerIcons: Record<string, string> = {
  linkedin: docsPath("/assets/logos/linkedin.svg"),
  x: docsPath("/assets/logos/x.svg"),
  youtube: docsPath("/assets/logos/youtube.svg"),
  tiktok: docsPath("/assets/logos/tiktok.svg"),
  pinterest: docsPath("/assets/logos/pinterest.svg"),
  facebook: docsPath("/assets/logos/facebook.svg"),
  instagram: docsPath("/assets/logos/instagram.svg"),
  threads: docsPath("/assets/logos/threads.svg"),
  bluesky: docsPath("/assets/logos/bluesky.svg"),
  telegram: docsPath("/assets/logos/telegram.svg"),
  mastodon: docsPath("/assets/logos/mastodon.svg"),
  pixelfed: docsPath("/assets/logos/pixelfed.svg"),
  peertube: docsPath("/assets/logos/peertube.svg"),
  lemmy: docsPath("/assets/logos/lemmy.svg"),
  piefed: docsPath("/assets/logos/piefed.svg"),
  discord: docsPath("/assets/logos/discord.svg"),
};

const serviceIcons: Record<string, string> = {
  casaos: docsPath("/assets/logos/casaos.svg"),
  coolify: docsPath("/assets/logos/coolify.svg"),
  docker: docsPath("/assets/logos/docker.svg"),
  dockge: docsPath("/assets/logos/dockge.svg"),
  dokploy: docsPath("/assets/logos/dokploy.svg"),
  nixos: docsPath("/assets/logos/nixos.svg"),
  portainer: docsPath("/assets/logos/portainer.svg"),
  zimaos: docsPath("/assets/logos/zimaos.png"),
};

const clientIcons = new Set([
  "antigravity",
  "chatgpt",
  "claude",
  "codex",
  "cursor",
  "devin",
  "gemini",
  "github-copilot",
  "grok",
  "hermes",
  "openclaw",
  "opencode",
  "perplexity",
  "vscode",
]);
const monochromeClients = new Set([
  "chatgpt",
  "cursor",
  "devin",
  "github-copilot",
  "grok",
  "opencode",
]);

const docs = defineDocs({ dir: "content/docs" });
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  plugins: [openapiPlugin()],
  icon: documentationIcon,
});

export function documentationIcon(name: string | undefined) {
  if (name && clientIcons.has(name))
    return (
      <img
        src={docsPath(`/clients/${name}.${name === "hermes" ? "png" : "svg"}`)}
        alt=""
        width={16}
        height={16}
        className={
          monochromeClients.has(name)
            ? "docs-client-icon docs-client-monochrome"
            : "docs-client-icon"
        }
      />
    );
  if (name && providerIcons[name])
    return (
      <img src={providerIcons[name]} alt="" width={16} height={16} className="docs-provider-icon" />
    );
  if (name && serviceIcons[name])
    return (
      <img src={serviceIcons[name]} alt="" width={16} height={16} className="docs-service-icon" />
    );
  if (name && name in icons) return createElement(icons[name as keyof typeof icons]);
}
