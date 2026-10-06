import { expect, test } from "bun:test";
import { mediaImageSource } from "./media-source";

test("native previews resolve protected media URLs and authenticate their image request", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return request.headers.get("Authorization") === "Bearer preview-token"
        ? new Response("image-bytes")
        : new Response("Unauthorized", { status: 401 });
    },
  });
  try {
    const base = server.url.origin;
    for (const uri of [`${base}/media/photo`, "/media/photo/thumb/small"]) {
      const source = mediaImageSource(uri, base, "preview-token");
      const response = await fetch(source.uri, {
        headers: (source as { headers?: Record<string, string> }).headers,
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("image-bytes");
    }
  } finally {
    server.stop(true);
  }
});

test("native previews never send OpenPost credentials to outside or local images", () => {
  for (const uri of [
    "https://cdn.example/photo.png",
    "file:///photo.png",
    "content://photo/1",
    "https://app.example/avatar.png",
  ]) {
    const source = mediaImageSource(uri, "https://app.example", "preview-token");
    expect(source).toEqual({ uri });
  }
});
