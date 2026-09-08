import { readdir, rm } from "node:fs/promises";
import { generateFiles } from "fumadocs-openapi";
import { openapi } from "../lib/openapi";

// Subfolders contain only generated operations. Remove retired endpoints on regeneration.
for (const entry of await readdir("./content/docs/api-reference", { withFileTypes: true })) {
  if (entry.isDirectory())
    await rm(`./content/docs/api-reference/${entry.name}`, { recursive: true });
}

await generateFiles({
  input: openapi,
  output: "./content/docs/api-reference",
  per: "operation",
  groupBy: "tag",
  name(entry) {
    if (entry.type !== "operation") return entry.info.title;
    return this.fromExtractedOperation(entry.item)?.operation.operationId ?? entry.info.title;
  },
  meta: true,
  beforeWrite(files) {
    const rootMeta = files.findIndex((file) => file.path === "meta.json");
    if (rootMeta !== -1) files.splice(rootMeta, 1);
    for (const file of files) {
      const title = { "mcp/meta.json": "MCP", "openpost-image-editor/meta.json": "Image editor" }[
        file.path
      ];
      if (title) file.content = JSON.stringify({ ...JSON.parse(file.content), title }, null, 2);
    }
  },
  frontmatter: (title, description) => ({ title, description, full: true }),
});
