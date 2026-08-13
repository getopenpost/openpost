import type { RequestHandler } from "./$types";
import {
  marketingRouteManifest,
  marketingSiteUrl,
} from "@openpost/social-images";

export const prerender = true;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const GET: RequestHandler = () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${marketingRouteManifest
  .map(
    (route) => `  <url>
    <loc>${escapeXml(`${marketingSiteUrl}${route.path}`)}</loc>
    <priority>${route.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
    },
  });
};
