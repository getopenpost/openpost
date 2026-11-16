export type ServerHeader = { name: string; value: string };

const HOSTED_ORIGIN = "https://app.openpo.st";
const RESERVED_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

export function validateServerHeaders(headers: ServerHeader[]): ServerHeader[] {
  const seen = new Set<string>();
  return headers.map(({ name, value }) => {
    const cleanName = name.trim();
    const lowerName = cleanName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cleanName)) {
      throw new Error("Enter a valid HTTP header name.");
    }
    if (RESERVED_NAMES.has(lowerName) || lowerName.startsWith("x-openpost-")) {
      throw new Error(`The ${cleanName} header is reserved by the app.`);
    }
    if (seen.has(lowerName)) throw new Error(`The ${cleanName} header is listed more than once.`);
    if (/[^\t\x20-\x7e\x80-\xff]/.test(value)) {
      throw new Error(`Enter a valid value for ${cleanName}, without line breaks.`);
    }
    seen.add(lowerName);
    return { name: cleanName, value: value.trim() };
  });
}

export function serverHeadersForUrl(
  url: string,
  baseUrl: string,
  headers: ServerHeader[],
): Record<string, string> {
  try {
    const server = new URL(baseUrl);
    const target = new URL(url, `${baseUrl}/`);
    if (
      !["http:", "https:"].includes(server.protocol) ||
      target.origin !== server.origin ||
      server.origin === HOSTED_ORIGIN
    )
      return {};
    return Object.fromEntries(
      validateServerHeaders(headers).map(({ name, value }) => [name, value]),
    );
  } catch {
    return {};
  }
}
