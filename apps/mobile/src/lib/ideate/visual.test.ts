import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ScreenshotDocument } from "@openpost/query-catalog";

const calls: { path: string; init: Record<string, unknown> }[] = [];
let responses: Record<string, unknown> = {};

mock.module("expo/fetch", () => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { setServer } = await import("../server");

const { previewTemplate, saveIdeateVisual } = await import("./visual");
const document = { title: "Chat" } as unknown as ScreenshotDocument;

const originalFetch = globalThis.fetch;
beforeEach(async () => {
  calls.length = 0;
  responses = {};
  await setServer("https://visual.example");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input as Request;
    let path = new URL(request.url).pathname.replace("/api/v1", "");
    path = path.replace(
      /^\/screenshot-templates\/designs\/[^/]+\/exports$/,
      "/screenshot-templates/designs/{id}/exports",
    );
    calls.push({ path, init: { body: await request.json() } });
    const reply = responses[path] as { data?: unknown; error?: unknown };
    return reply.error ? Response.json(reply.error, { status: 422 }) : Response.json(reply.data);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("template preview requests scale 2 and returns size", async () => {
  responses["/screenshot-templates/previews"] = {
    data: { data_base64: "QUJD", width: 1080, height: 600 },
  };
  const preview = await previewTemplate("ws", document, new AbortController().signal);
  expect(preview).toEqual({ base64: "QUJD", width: 1080, height: 600 });
  expect(calls[0]?.init.body).toEqual({
    workspace_id: "ws",
    document,
    scale: 2,
  });
});

test("template preview surfaces the server's 422 message", async () => {
  responses["/screenshot-templates/previews"] = {
    error: { detail: "Text overflows its frame" },
  };
  await expect(previewTemplate("ws", document, new AbortController().signal)).rejects.toThrow(
    "Text overflows its frame",
  );
});

test("visual export is rendered by the server and keeps alt text", async () => {
  responses["/screenshot-templates/designs"] = {
    data: { id: "design", revision: 3 },
  };
  responses["/screenshot-templates/designs/{id}/exports"] = {
    data: { media: { id: "media-1" } },
  };
  const id = await saveIdeateVisual("ws", { document }, "alt", () => true);
  expect(id).toBe("media-1");
  expect(calls.map((call) => call.path)).toEqual([
    "/screenshot-templates/designs",
    "/screenshot-templates/designs/{id}/exports",
  ]);
  expect(calls[1]?.init.body).toEqual({ revision: 3, alt_text: "alt" });
});

test("export stops when the session changed after creating the design", async () => {
  responses["/screenshot-templates/designs"] = {
    data: { id: "design", revision: 1 },
  };
  let current = true;
  const pending = saveIdeateVisual("ws", { document }, "", () => {
    const value = current;
    current = false;
    return value;
  });
  await expect(pending).rejects.toThrow("Your Workspace or session changed.");
  expect(calls).toHaveLength(1);
});
