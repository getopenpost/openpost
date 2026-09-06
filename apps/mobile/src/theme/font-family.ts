const RUNTIME_FONT_PREFIX = "OpenPostTheme_";
const MAX_READABLE_LENGTH = 40;

/**
 * Expo registers downloaded fonts by a caller-owned family name. Namespacing
 * by immutable resource ID prevents two organizations or revisions from
 * replacing each other's loaded faces.
 */
export function nativeThemeRuntimeFontFamily(resourceId: string): string {
  const readable = resourceId
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_READABLE_LENGTH);
  return `${RUNTIME_FONT_PREFIX}${readable || "resource"}_${fnv1a(resourceId)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    hash ^= codePoint;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
