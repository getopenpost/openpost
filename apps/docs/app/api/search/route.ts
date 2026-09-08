import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";
import { documentationSection } from "@/lib/sections";

export const dynamic = "force-static";
export const { staticGET: GET } = createFromSource(source, {
  buildIndex(page) {
    return {
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      structuredData: page.data.structuredData,
      tag: documentationSection(page.url).id,
    };
  },
});
