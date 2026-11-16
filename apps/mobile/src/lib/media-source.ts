// Authenticated media source contract (web and native share this shape).
//
// Server: GET /media/:id serves the original; GET /media/:id/thumb/:size serves
// a thumbnail where :size is "sm" or "md" (see serveThumbnailSize in
// apps/server/internal/api/handlers/media.go). A missing thumbnail is a 404,
// so previews request the thumbnail first and fall back to the original once.
// Web does this in apps/web/src/lib/components/media-preview-image.svelte;
// native does it in apps/mobile/src/components/media-image.tsx via the helper
// below. The two transports differ on purpose: web relies on the session
// cookie, native attaches a bearer token.
//
// Rules both sides honor:
// - Only same-origin /media/ URLs are rewritten or receive the bearer token.
//   Proxy credentials apply to all same-origin server paths. Local
//   (file://, content://, data:) and external URLs receive neither credential.
// - Protected previews must stay out of the disk cache, so MediaImage keeps
//   expo-image cachePolicy="none".

import { serverHeadersForUrl, type ServerHeader } from "./server-headers";

export type MediaPreviewSize = "sm" | "md" | "original";

export type MediaSource = {
  uri: string;
  headers?: Record<string, string>;
};

function withAuth(
  uri: string,
  token: string | null,
  proxyHeaders: Record<string, string>,
): MediaSource {
  const headers = { ...proxyHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return { uri, ...(Object.keys(headers).length ? { headers } : {}) };
}

function mediaIdFromThumbPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length >= 4 &&
    segments[0] === "media" &&
    segments[segments.length - 2] === "thumb"
  ) {
    return segments.slice(1, -2).join("/");
  }
  return null;
}

export function mediaPreviewSource(
  uri: string,
  size: MediaPreviewSize,
  serverBaseUrl: string,
  token: string | null,
  headers: ServerHeader[] = [],
): MediaSource {
  let server: URL;
  let resolved: URL;
  try {
    server = new URL(serverBaseUrl);
    resolved = new URL(uri, `${serverBaseUrl}/`);
  } catch {
    return { uri };
  }
  if (resolved.origin !== server.origin) return { uri };
  const proxyHeaders = serverHeadersForUrl(resolved.toString(), serverBaseUrl, headers);
  if (!resolved.pathname.startsWith("/media/")) {
    return Object.keys(proxyHeaders).length
      ? withAuth(resolved.toString(), null, proxyHeaders)
      : { uri };
  }
  const thumbId = mediaIdFromThumbPath(resolved.pathname);
  if (thumbId) {
    if (size === "original") {
      return withAuth(
        `${resolved.origin}/media/${thumbId}${resolved.search}${resolved.hash}`,
        token,
        proxyHeaders,
      );
    }
    return withAuth(
      `${resolved.origin}/media/${thumbId}/thumb/${size}${resolved.search}${resolved.hash}`,
      token,
      proxyHeaders,
    );
  }
  if (size === "original") {
    return withAuth(resolved.toString(), token, proxyHeaders);
  }
  const rest = resolved.pathname.slice("/media/".length);
  if (!rest || rest.includes("/")) {
    return withAuth(resolved.toString(), token, proxyHeaders);
  }
  const id = rest.replace(/\.[^/.]+$/, "");
  if (!id) {
    return withAuth(resolved.toString(), token, proxyHeaders);
  }
  return withAuth(
    `${resolved.origin}/media/${id}/thumb/${size}${resolved.search}${resolved.hash}`,
    token,
    proxyHeaders,
  );
}

export function mediaImageSource(
  uri: string,
  serverBaseUrl: string,
  token: string | null,
  headers: ServerHeader[] = [],
): MediaSource {
  return mediaPreviewSource(uri, "original", serverBaseUrl, token, headers);
}

// A preview requests the thumbnail first and falls back to the original once,
// because a missing thumbnail is a 404. Callers walk this list on load error.
export function mediaPreviewCandidates(
  uri: string,
  size: MediaPreviewSize,
  serverBaseUrl: string,
  token: string | null,
  headers: ServerHeader[] = [],
): MediaSource[] {
  const requested = mediaPreviewSource(uri, size, serverBaseUrl, token, headers);
  if (size === "original") return [requested];
  const original = mediaPreviewSource(uri, "original", serverBaseUrl, token, headers);
  return original.uri === requested.uri ? [requested] : [requested, original];
}
