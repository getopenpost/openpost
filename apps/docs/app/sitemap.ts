import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return source
    .getPages()
    .map((page) => ({ url: `https://docs.openpo.st${page.url}` }))
    .sort((left, right) => left.url.localeCompare(right.url));
}
