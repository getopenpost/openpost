import { expect, test } from "bun:test";
import { mediaImageSource, mediaPreviewCandidates, mediaPreviewSource } from "./media-source";

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
    for (const uri of [`${base}/media/photo`, "/media/photo/thumb/sm"]) {
      const source = mediaImageSource(uri, base, "preview-token");
      expect(source.uri).toBe(`${base}/media/photo`);
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

test("native list previews request the md thumbnail with bearer auth", () => {
  const source = mediaPreviewSource("/media/photo", "md", "https://app.example", "preview-token");
  expect(source.uri).toBe("https://app.example/media/photo/thumb/md");
  expect(source.headers).toEqual({ Authorization: "Bearer preview-token" });
});

test("native previews support every thumbnail tier and the original", () => {
  const base = "https://app.example";
  expect(mediaPreviewSource("/media/photo", "sm", base, null)).toEqual({
    uri: `${base}/media/photo/thumb/sm`,
  });
  expect(mediaPreviewSource("/media/photo", "original", base, null)).toEqual({
    uri: `${base}/media/photo`,
  });
  expect(mediaPreviewSource(`${base}/media/photo`, "md", base, null).uri).toBe(
    `${base}/media/photo/thumb/md`,
  );
});

test("native previews normalize an existing thumbnail path instead of stacking tiers", () => {
  const base = "https://app.example";
  expect(mediaPreviewSource("/media/photo/thumb/sm", "md", base, null).uri).toBe(
    `${base}/media/photo/thumb/md`,
  );
  expect(mediaPreviewSource("/media/photo/thumb/md", "original", base, null).uri).toBe(
    `${base}/media/photo`,
  );
});

test("native previews never thumbnail or authenticate outside or local images", () => {
  for (const size of ["sm", "md", "original"] as const) {
    for (const uri of [
      "https://cdn.example/photo.png",
      "file:///photo.png",
      "content://photo/1",
      "data:image/png;base64,AAA",
      "https://app.example/avatar.png",
    ]) {
      expect(mediaPreviewSource(uri, size, "https://app.example", "preview-token")).toEqual({
        uri,
      });
    }
  }
});

test("mediaPreviewCandidates requests the thumbnail first and falls back to the original once", () => {
  const base = "https://app.example";
  const token = "preview-token";
  expect(mediaPreviewCandidates("/media/photo", "md", base, token)).toEqual([
    mediaPreviewSource("/media/photo", "md", base, token),
    mediaPreviewSource("/media/photo", "original", base, token),
  ]);
  expect(mediaPreviewCandidates("/media/photo/thumb/sm", "sm", base, token)).toEqual([
    mediaPreviewSource("/media/photo/thumb/sm", "sm", base, token),
    mediaPreviewSource("/media/photo/thumb/sm", "original", base, token),
  ]);
  expect(mediaPreviewCandidates("/media/photo", "original", base, token)).toHaveLength(1);
  expect(mediaPreviewCandidates("https://cdn.example/photo.png", "md", base, token)).toEqual([
    { uri: "https://cdn.example/photo.png" },
  ]);
});
