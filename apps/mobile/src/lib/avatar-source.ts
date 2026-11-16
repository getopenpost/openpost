// Account and workspace avatar source contract.
//
// The data already reaches the app (SocialAccount.account_avatar_url,
// analytics AccountOverview.avatar_url, Workspace.avatar_url), but avatar URLs
// can be server-relative public paths (for example the LinkedIn cache served
// from /avatars/). mediaImageSource only rewrites and credentials protected
// /media/ paths, so a relative /avatars/ URL would reach expo-image unresolved.
//
// Rules this module honors (shared with media-source.ts, never widened):
// - Same-origin server paths are absolutized so expo-image can fetch them.
// - The bearer is attached only for same-origin protected /media/ paths.
// - Local (file://, content://, data:) and external URLs pass through untouched
//   with no Authorization header.
// - Same-origin avatars carry configured proxy credentials. Public avatars
//   without credentials are cacheable; credentialed previews opt out of disk cache.

import type { ServerHeader } from "./server-headers";
import { mediaImageSource, type MediaSource } from "./media-source";

// Monogram rule shared with the web account avatar
// (apps/web/src/lib/components/social-account-avatar.svelte): the first and
// last word initials, or the first two characters of a single word.
export function accountInitials(name: string): string {
  const normalized = name.trim().replace(/^@+/, "");
  if (!normalized) return "?";
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

export type AvatarSource = MediaSource & {
  // True when the source carries no credential and may enter the image cache.
  cacheable: boolean;
};

export function avatarImageSource(
  uri: string,
  serverBaseUrl: string,
  token: string | null,
  headers: ServerHeader[] = [],
): AvatarSource {
  const resolved = mediaImageSource(uri, serverBaseUrl, token, headers);
  if (resolved.headers) {
    return { ...resolved, cacheable: false };
  }
  if (resolved.uri.startsWith("/")) {
    try {
      const server = new URL(serverBaseUrl);
      const absolute = new URL(resolved.uri, `${serverBaseUrl}/`);
      if (absolute.origin === server.origin) {
        return { uri: absolute.toString(), cacheable: true };
      }
    } catch {
      // No usable server base: leave the relative URI untouched.
    }
  }
  return { ...resolved, cacheable: true };
}
