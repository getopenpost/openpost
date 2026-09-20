import { source } from "@/lib/source";
import type { MetadataRoute } from "next";
import { docsSiteUrl } from "@openpost/social-images";

export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return source
    .getPages()
    .map((page) => ({ url: page.url === "/" ? docsSiteUrl : `${docsSiteUrl}${page.url}` }))
    .sort((left, right) => left.url.localeCompare(right.url));
}
