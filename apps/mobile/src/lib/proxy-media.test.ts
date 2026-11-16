import { describe, expect, test } from "bun:test";
import { downloadProxyMedia, hasProxyMediaHeaders } from "./proxy-media";

const source = {
  uri: "https://proxy.example.com/media/photo",
  headers: { "P-Access-Token": "proxy-secret", Authorization: "Bearer session" },
};

describe("proxy-protected native media", () => {
  test("streams into a temporary local file and exposes no credentials to native renderers", async () => {
    const chunks: number[][] = [];
    let deleted = false;
    let request: RequestInit | undefined;
    const result = await downloadProxyMedia(source, new AbortController().signal, {
      fetch: async (_uri, init) => {
        request = init;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.enqueue(new Uint8Array([3]));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "image/png" } },
        );
      },
      createFile: async (extension) => {
        expect(extension).toBe(".png");
        return {
          uri: "file:///temporary.png",
          create() {},
          delete() {
            deleted = true;
          },
          writableStream: () =>
            new WritableStream({
              write(chunk) {
                chunks.push([...chunk]);
              },
            }),
        };
      },
    });
    expect(request?.redirect).toBe("error");
    expect(request?.headers).toEqual(source.headers);
    expect(result.uri).toBe("file:///temporary.png");
    expect(chunks).toEqual([[1, 2], [3]]);
    expect(deleted).toBe(false);
    result.dispose();
    expect(deleted).toBe(true);
  });

  test("cancels the response and deletes a partial file when the source changes", async () => {
    const controller = new AbortController();
    let cancelled = false;
    let deleted = false;
    let abortedWriter = false;
    await expect(
      downloadProxyMedia(source, controller.signal, {
        fetch: async () =>
          new Response(
            new ReadableStream({
              pull(stream) {
                stream.enqueue(new Uint8Array([1]));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        createFile: async () => ({
          uri: "file:///partial",
          create() {},
          delete() {
            deleted = true;
          },
          writableStream: () =>
            new WritableStream({
              write() {
                controller.abort();
              },
              abort() {
                abortedWriter = true;
              },
            }),
        }),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
    expect(deleted).toBe(true);
    expect(abortedWriter).toBe(true);
  });

  test("closes failed responses and responses that cannot be stored", async () => {
    for (const status of [401, 200]) {
      let cancelled = false;
      await expect(
        downloadProxyMedia(source, new AbortController().signal, {
          fetch: async () =>
            new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              { status },
            ),
          createFile: async () => {
            throw new Error("Storage unavailable");
          },
        }),
      ).rejects.toThrow(status === 401 ? "Could not load this attachment" : "Storage unavailable");
      expect(cancelled).toBe(true);
    }
  });

  test("keeps local, external and bearer-only media on their existing transport", () => {
    expect(hasProxyMediaHeaders(source)).toBe(true);
    expect(hasProxyMediaHeaders({ uri: "file:///photo" })).toBe(false);
    expect(hasProxyMediaHeaders({ uri: "https://external.example.com/photo" })).toBe(false);
    expect(
      hasProxyMediaHeaders({ uri: source.uri, headers: { Authorization: "Bearer session" } }),
    ).toBe(false);
  });
});
