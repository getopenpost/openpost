export const documentationSections = [
  { id: "guides", label: "Guides", href: "/" },
  { id: "video-editor", label: "Video Editor", href: "/video-editor" },
  { id: "image-editor", label: "Image Editor", href: "/image-editor" },
  { id: "automate", label: "Automate", href: "/automate", paths: ["/api-reference"] },
  { id: "mcp", label: "AI assistants", href: "/mcp" },
  { id: "self-hosting", label: "Self-hosting", href: "/self-hosting" },
] as const;

export function documentationSection(pathname: string) {
  return (
    documentationSections.find(
      (section) =>
        section.href !== "/" &&
        [section.href, ...("paths" in section ? section.paths : [])].some(
          (path) => pathname === path || pathname.startsWith(`${path}/`),
        ),
    ) ?? documentationSections[0]
  );
}
