import { expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

mock.module("expo/fetch", () => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const { api, errorMessage } = await import("./client");

test("shows validation details after openapi-fetch consumes the error response", async () => {
  const client = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async () =>
      Response.json(
        {
          title: "Unprocessable Entity",
          detail: "validation failed",
          errors: [{ message: "unexpected property", location: "body.media" }],
        },
        { status: 422 },
      ),
  });
  const { error, response } = await client.PUT("/publications/{id}", {
    params: { path: { id: "draft" } },
    body: { expected_revision: 1, source_text: "Draft" },
  });
  expect(response.bodyUsed).toBe(true);
  expect(await errorMessage(response, "Could not save", error)).toBe(
    "body.media: unexpected property",
  );
});

test("shows server detail and keeps a readable fallback for missing or malformed errors", async () => {
  expect(
    await errorMessage(
      Response.json({ detail: "Pick a future publish time" }, { status: 400 }),
      "Could not save",
    ),
  ).toBe("Pick a future publish time");
  expect(await errorMessage(new Response("Unavailable", { status: 503 }), "Could not save")).toBe(
    "Could not save (503)",
  );
  expect(await errorMessage(undefined, "Could not save")).toBe("Could not save");
});

test("native API sends proxy credentials for pairing and refreshes them after editing", async () => {
  const { setServer, updateServerHeaders, clearServer } = await import("../server");
  const received: { path: string; secret: string | null; client: string | null }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input as Request;
    received.push({
      path: new URL(request.url).pathname,
      secret: request.headers.get("P-Access-Token"),
      client: request.headers.get("X-OpenPost-Client"),
    });
    return Response.json({});
  }) as typeof fetch;
  try {
    await setServer("https://proxy.example", [{ name: "P-Access-Token", value: "first-secret" }]);
    await api().POST("/cli/auth/start", {
      body: { client_name: "test", client_os: "android", client_version: "test" },
    });
    await updateServerHeaders([{ name: "P-Access-Token", value: "edited-secret" }]);
    await api().POST("/cli/auth/poll", { body: { device_code: "device" } });
    expect(received).toEqual([
      { path: "/api/v1/cli/auth/start", secret: "first-secret", client: "native" },
      { path: "/api/v1/cli/auth/poll", secret: "edited-secret", client: "native" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await clearServer();
  }
});
