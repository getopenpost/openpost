export function docsRouteFromPage(page) {
  const normalized = page.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized === "index.md") return "/";
  const withoutExtension = normalized.replace(/\.md$/, "");
  return withoutExtension.endsWith("/index")
    ? `/${withoutExtension.slice(0, -"/index".length)}/`
    : `/${withoutExtension}`;
}
