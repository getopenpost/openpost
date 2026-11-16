/** Native fetch with redirect rejection, so proxy credentials cannot follow a redirect. */
export async function proxyFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  // React Native's global XHR-backed fetch does not enforce redirect: "error".
  const { fetch } = await import("expo/fetch");
  // Bun adds a nonstandard textStream member to its ambient Response type.
  return fetch(input, { ...init, redirect: "error" }) as unknown as Promise<Response>;
}
