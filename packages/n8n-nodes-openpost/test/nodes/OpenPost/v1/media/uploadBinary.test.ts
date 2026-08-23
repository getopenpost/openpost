import { describe, expect, test } from "bun:test";

import { uploadBinaryMedia } from "../../../../../nodes/OpenPost/v1/media/uploadBinary";

describe("OpenPost binary upload", () => {
  test("uploads bytes to the returned target without forwarding bearer auth", async () => {
    const calls: Array<{ authenticated: boolean; options: Record<string, any> }> = [];
    const context = {
      getInputData() {
        return [{ binary: { data: { fileName: "clip.mp4", mimeType: "video/mp4" } } }];
      },
      helpers: {
        async getBinaryDataBuffer() {
          return Buffer.from("media");
        },
        async httpRequest(options: Record<string, any>) {
          calls.push({ authenticated: false, options });
          return { statusCode: 200, body: "" };
        },
        httpRequestWithAuthentication: async function (
          _credentialType: string,
          options: Record<string, any>,
        ) {
          calls.push({ authenticated: true, options });
          if (String(options.url).endsWith("/media/upload-session")) {
            return {
              body: {
                media_id: "media-1",
                complete_url: "/api/v1/media/upload-session/session-1/complete",
                deduped: false,
                upload: {
                  method: "PUT",
                  url: "https://storage.example/upload",
                  headers: { "Content-Type": "video/mp4", "x-upload-token": "target-token" },
                },
              },
              headers: {},
              statusCode: 200,
            };
          }
          return { body: { id: "media-1" }, headers: {}, statusCode: 200 };
        },
      },
    } as any;

    await uploadBinaryMedia(context, {
      baseUrl: "https://openpost.example",
      itemIndex: 0,
      executionId: "exec-1",
      workspaceId: "ws-1",
      binaryPropertyName: "data",
      idempotencyKey: "event-1",
    });

    const uploadCall = calls.find((call) => call.options.url === "https://storage.example/upload");
    expect(uploadCall?.authenticated).toBe(false);
    expect(uploadCall?.options.headers).toEqual({
      "Content-Type": "video/mp4",
      "x-upload-token": "target-token",
    });
    expect(uploadCall?.options.headers.Authorization).toBeUndefined();
  });
});
