import { describe, expect, test } from "bun:test";

import { uploadBinaryMedia } from "../../../../../nodes/OpenPost/v1/media/uploadBinary";

describe("OpenPost binary upload", () => {
  test.each([
    { completeURL: "/api/v1/media/upload-session/session-1/complete", reject: false },
    { completeURL: "https://evil.example/steal", reject: true },
  ])(
    "validates completion URL $completeURL before credential use",
    async ({ completeURL, reject }) => {
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
                  complete_url: completeURL,
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

      const uploading = uploadBinaryMedia(context, {
        baseUrl: "https://openpost.example",
        itemIndex: 0,
        executionId: "exec-1",
        workspaceId: "ws-1",
        binaryPropertyName: "data",
        idempotencyKey: "event-1",
      });

      if (reject) {
        await expect(uploading).rejects.toThrow("completion URL");
        expect(calls.some((call) => String(call.options.url).includes("evil.example"))).toBe(false);
        return;
      }
      await uploading;

      const uploadCall = calls.find(
        (call) => call.options.url === "https://storage.example/upload",
      );
      expect(uploadCall?.authenticated).toBe(false);
      expect(uploadCall?.options.headers).toEqual({
        "Content-Type": "video/mp4",
        "x-upload-token": "target-token",
      });
      expect(uploadCall?.options.headers.Authorization).toBeUndefined();
      const completeCall = calls.find((call) =>
        String(call.options.url).endsWith("/media/upload-session/session-1/complete"),
      );
      expect(completeCall?.authenticated).toBe(true);
      expect(completeCall?.options.headers["Idempotency-Key"]).toBeUndefined();
    },
  );

  test("sends a relative local-storage upload target to the OpenPost origin with credentials", async () => {
    const calls: Array<{ authenticated: boolean; options: Record<string, any> }> = [];
    const context = {
      getInputData() {
        return [{ binary: { data: { fileName: "photo.png", mimeType: "image/png" } } }];
      },
      helpers: {
        async getBinaryDataBuffer() {
          return Buffer.from("media");
        },
        async httpRequest(options: Record<string, any>) {
          calls.push({ authenticated: false, options });
          new URL(String(options.url));
          return { statusCode: 200, body: "" };
        },
        httpRequestWithAuthentication: async function (
          _credentialType: string,
          options: Record<string, any>,
        ) {
          calls.push({ authenticated: true, options });
          new URL(String(options.url));
          if (String(options.url).endsWith("/media/upload-session")) {
            return {
              body: {
                media_id: "media-1",
                complete_url: "/api/v1/media/upload-session/media-1/complete",
                deduped: false,
                upload: {
                  method: "PUT",
                  url: "/api/v1/media/upload-session/media-1/content",
                  headers: { "Content-Type": "image/png" },
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

    const uploadCall = calls.find((call) => call.options.method === "PUT");
    expect(uploadCall?.options.url).toBe(
      "https://openpost.example/api/v1/media/upload-session/media-1/content",
    );
    expect(uploadCall?.authenticated).toBe(true);
    expect(uploadCall?.options.headers).toEqual({ "Content-Type": "image/png" });
  });
});
