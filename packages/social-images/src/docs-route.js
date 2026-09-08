export function docsRouteFromPage(page) {
  const normalized = page.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized === "index.md") return "/";
  const withoutExtension = normalized.replace(/\.mdx?$/, "");
  if (!withoutExtension.endsWith("/index")) return `/${withoutExtension}`;
  const parent = withoutExtension.slice(0, -"/index".length);
  return normalized.endsWith(".mdx") ? `/${parent}` : `/${parent}/`;
}
