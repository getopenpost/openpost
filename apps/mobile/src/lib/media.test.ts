import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";
import { files, resetFileSystem, uploads } from "../../tests/fixtures/file-system";

const actualSize = 64;
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { uploadAttachment } = await import("./media");

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
