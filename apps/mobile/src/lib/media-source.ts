export function mediaImageSource(
  uri: string,
  serverBaseUrl: string,
  token: string | null,
): {
  uri: string;
  headers?: Record<string, string>;
} {
  try {
    const server = new URL(serverBaseUrl);
    const resolved = new URL(uri, `${serverBaseUrl}/`);
    if (resolved.origin !== server.origin || !resolved.pathname.startsWith("/media/")) {
      return { uri };
    }
    return {
      uri: resolved.toString(),
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  } catch {
    return { uri };
  }
}
