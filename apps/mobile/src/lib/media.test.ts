import { afterEach, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

const actualSize = 64;
let uploadedSize = 0;
mock.module("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: async () => ({ exists: true, isDirectory: false, size: actualSize }),
  uploadAsync: async (_url: string, _uri: string, options: { headers: Record<string, string> }) => {
    uploadedSize = Number(options.headers["Content-Length"]);
    return { status: uploadedSize === actualSize ? 200 : 403, body: "" };
  },
}));
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { uploadAttachment } = await import("./media");

afterEach(() => {
  uploadedSize = 0;
});

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
    expect(uploadedSize).toBe(64);
    expect(completed).toBe(true);
  });
}
