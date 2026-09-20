export const documentationSections = [
  { id: "guides", label: "Guides", href: "/" },
  { id: "self-hosting", label: "Self-hosting", href: "/self-hosting" },
  { id: "mcp", label: "AI assistants", href: "/mcp" },
  { id: "automate", label: "Automate", href: "/automate" },
  { id: "video-editor", label: "Video Editor", href: "/video-editor" },
  { id: "image-editor", label: "Image Editor", href: "/image-editor" },
  { id: "api-reference", label: "API reference", href: "/api-reference" },
] as const;

export function documentationSection(pathname: string) {
  const localPath = pathname.startsWith(docsBasePath)
    ? pathname.slice(docsBasePath.length) || "/"
    : pathname;
  return (
    documentationSections.find(
      ({ href }) => href !== "/" && (localPath === href || localPath.startsWith(`${href}/`)),
    ) ?? documentationSections[0]
  );
}
import { docsBasePath } from "@openpost/social-images";
