export const documentationSections = [
  { id: "guides", label: "Guides", href: "/" },
  { id: "self-hosting", label: "Self-hosting", href: "/self-hosting" },
  { id: "mcp", label: "AI assistants", href: "/mcp" },
  { id: "api", label: "API reference", href: "/api-reference" },
] as const;

export function documentationSection(pathname: string) {
  return (
    documentationSections.find(
      ({ href }) => href !== "/" && (pathname === href || pathname.startsWith(`${href}/`)),
    ) ?? documentationSections[0]
  );
}
