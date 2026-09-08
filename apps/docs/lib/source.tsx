import { defineDocs } from "fumadocs-mdx/macro";
import { loader } from "fumadocs-core/source";
import { openapiPlugin } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";

const providerIcons: Record<string, string> = {
  linkedin: "/assets/logos/linkedin.svg",
  x: "/assets/logos/x.svg",
  youtube: "/assets/logos/youtube.svg",
  tiktok: "/assets/logos/tiktok.svg",
  pinterest: "/assets/logos/pinterest.svg",
  facebook: "/assets/logos/facebook.svg",
  mastodon: "/assets/logos/mastodon.svg",
  discord: "/assets/logos/discord.svg",
};

const docs = defineDocs({ dir: "content/docs" });
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  plugins: [openapiPlugin()],
  icon(name) {
    if (name && providerIcons[name])
      return (
        <img
          src={providerIcons[name]}
          alt=""
          width={16}
          height={16}
          className="docs-provider-icon"
        />
      );
    if (name && name in icons) return createElement(icons[name as keyof typeof icons]);
  },
});
