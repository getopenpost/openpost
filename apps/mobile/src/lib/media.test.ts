import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";
import { files, resetFileSystem, uploads, uploadRequests } from "../../tests/fixtures/file-system";

const actualSize = 64;
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { attachmentLimitsFromStorage, attachmentSizeError, uploadAttachment } =
  await import("./media");

beforeEach(() => {
  resetFileSystem();
  files.set("file:///compressed.webp", "x".repeat(actualSize));
});
afterEach(resetFileSystem);

for (const reportedSize of [89216, null]) {
  test(`uploads the actual local image size when picker reports ${reportedSize}`, async () => {
    let reservedSize: unknown;
    let completed = false;
    const client = createClient<paths>({
      baseUrl: "https://review.invalid/api/v1",
      fetch: async (request) => {
        if (new URL(request.url).pathname.endsWith("/complete")) {
          completed = true;
          return Response.json({});
        }
        const body = await request.json();
        reservedSize = body.size;
        return Response.json({
          media_id: "image",
          deduped: false,
          upload: {
            method: "PUT",
            url: "https://storage.invalid/image",
            headers: { "Content-Length": String(body.size), "Content-Type": "image/webp" },
          },
        });
      },
    });
    expect(
      await uploadAttachment(
        {
          localId: "picker",
          uri: "file:///compressed.webp",
          mimeType: "image/webp",
          filename: "31408.webp",
          size: reportedSize,
        },
        { client, workspaceId: "workspace" },
      ),
    ).toBe("image");
    expect(reservedSize).toBe(64);
    expect(uploads).toEqual([{ uri: "file:///compressed.webp", size: 64 }]);
    expect(completed).toBe(true);
  });
}

test("attachmentSizeError allows a 200 MB video", () => {
  expect(
    attachmentSizeError(
      { mimeType: "video/mp4", filename: "screen.mp4", size: 200 * 1024 * 1024 },
      { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
    ),
  ).toBeNull();
});

test("attachmentSizeError rejects an over-limit video naming the video limit", () => {
  const message = attachmentSizeError(
    { mimeType: "video/mp4", filename: "long.mp4", size: 17 * 1024 * 1024 * 1024 },
    { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
  );
  expect(typeof message).toBe("string");
  expect(message as string).toMatch(/16\s?GB/);
});

test("attachmentSizeError rejects an image above 50 MiB", () => {
  const message = attachmentSizeError(
    { mimeType: "image/jpeg", filename: "photo.jpg", size: 51 * 1024 * 1024 },
    { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
  );
  expect(typeof message).toBe("string");
  expect(message as string).toMatch(/50\s?MB/);
});

test("attachmentSizeError treats unknown MIME as non-video", () => {
  const message = attachmentSizeError(
    { mimeType: "application/octet-stream", filename: "blob.bin", size: 51 * 1024 * 1024 },
    { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
  );
  expect(typeof message).toBe("string");
});

test("attachmentSizeError allows unknown size to defer to the upload path", () => {
  expect(
    attachmentSizeError(
      { mimeType: "video/mp4", filename: "screen.mp4", size: null },
      { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
    ),
  ).toBeNull();
});

test("attachmentLimitsFromStorage reads the served per-kind limits", () => {
  expect(
    attachmentLimitsFromStorage({
      upload_limits: {
        default_bytes: 50 * 1024 * 1024,
        video_bytes: 16 * 1024 * 1024 * 1024,
        brand_font_bytes: 10 * 1024 * 1024,
      },
    }),
  ).toEqual({
    videoBytes: 16 * 1024 * 1024 * 1024,
    defaultBytes: 50 * 1024 * 1024,
    brandFontBytes: 10 * 1024 * 1024,
  });
});

test("attachmentLimitsFromStorage falls back per field when the response predates limits", () => {
  expect(attachmentLimitsFromStorage(null)).toEqual(attachmentLimitsFromStorage(undefined));
  const fallback = attachmentLimitsFromStorage({});
  expect(fallback.defaultBytes).toBe(50 * 1024 * 1024);
  expect(fallback.videoBytes).toBe(16 * 1024 * 1024 * 1024);
  expect(fallback.brandFontBytes).toBe(10 * 1024 * 1024);
});

test("attachmentSizeError enforces served limits rather than restated constants", () => {
  const served = attachmentLimitsFromStorage({
    upload_limits: {
      default_bytes: 10 * 1024 * 1024,
      video_bytes: 16 * 1024 * 1024 * 1024,
      brand_font_bytes: 10 * 1024 * 1024,
    },
  });
  const message = attachmentSizeError(
    { mimeType: "image/jpeg", filename: "photo.jpg", size: 11 * 1024 * 1024 },
    served,
  );
  expect(typeof message).toBe("string");
  expect(message as string).toMatch(/10\s?MB/);
  expect(
    attachmentSizeError(
      { mimeType: "image/jpeg", filename: "photo.jpg", size: 11 * 1024 * 1024 },
      { videoBytes: 16 * 1024 * 1024 * 1024, defaultBytes: 50 * 1024 * 1024 },
    ),
  ).toBeNull();
});

test("uploadAttachment preflights with served limits when provided", async () => {
  files.set("file:///big.webp", "x".repeat(2048));
  const served = attachmentLimitsFromStorage({
    upload_limits: {
      default_bytes: 1024,
      video_bytes: 16 * 1024 * 1024 * 1024,
      brand_font_bytes: 10 * 1024 * 1024,
    },
  });
  await expect(
    uploadAttachment(
      {
        localId: "picker",
        uri: "file:///big.webp",
        mimeType: "image/webp",
        filename: "big.webp",
        size: null,
      },
      { client: undefined as never, workspaceId: "workspace", limits: served },
    ),
  ).rejects.toThrow(/or smaller/);
});

for (const target of ["https://proxy.example/upload", "https://storage.example/upload"]) {
  test(`direct uploads scope proxy credentials and redirect policy for ${target}`, async () => {
    const { setServer, clearServer } = await import("./server");
    await setServer("https://proxy.example", [{ name: "P-Access-Token", value: "proxy-secret" }]);
    const client = createClient<paths>({
      baseUrl: "https://proxy.example/api/v1",
      fetch: async (request) =>
        new URL(request.url).pathname.endsWith("/complete")
          ? Response.json({})
          : Response.json({
              media_id: "photo",
              deduped: false,
              upload: {
                url: target,
                method: "PUT",
                headers: { "Content-Length": "64", "Content-Type": "image/webp" },
              },
            }),
    });
    try {
      await uploadAttachment(
        {
          localId: "picker",
          uri: "file:///compressed.webp",
          mimeType: "image/webp",
          filename: "photo.webp",
          size: 64,
        },
        { client, workspaceId: "workspace" },
      );
      const sameOrigin = target.startsWith("https://proxy.example/");
      expect(uploadRequests[0]).toEqual({
        url: target,
        headers: {
          "Content-Length": "64",
          "Content-Type": "image/webp",
          ...(sameOrigin ? { "P-Access-Token": "proxy-secret" } : {}),
        },
        followRedirects: !sameOrigin,
      });
    } finally {
      await clearServer();
    }
  });
}
