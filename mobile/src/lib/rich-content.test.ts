import { describe, expect, it } from "bun:test";

import { pendingAttachmentFromRichContentImage } from "./rich-content";

describe("pendingAttachmentFromRichContentImage", () => {
  it("normalizes a keyboard image into the attachment contract", () => {
    expect(
      pendingAttachmentFromRichContentImage({
        localId: "keyboard-42-1",
        uri: "file:///cache/openpost/rich-content/image.png",
        mimeType: "image/png",
        filename: "image.png",
        size: 1234,
      }),
    ).toEqual({
      localId: "keyboard-42-1",
      uri: "file:///cache/openpost/rich-content/image.png",
      mimeType: "image/png",
      filename: "image.png",
      size: 1234,
    });
  });

  it("rejects incomplete payloads and normalizes unknown sizes", () => {
    expect(
      pendingAttachmentFromRichContentImage({
        localId: "keyboard-42-2",
        uri: "file:///cache/openpost/rich-content/image.jpg",
        mimeType: "image/jpeg",
        filename: "",
        size: -1,
      }),
    ).toEqual({
      localId: "keyboard-42-2",
      uri: "file:///cache/openpost/rich-content/image.jpg",
      mimeType: "image/jpeg",
      filename: "keyboard-image.jpg",
      size: null,
    });

    expect(
      pendingAttachmentFromRichContentImage({
        localId: "keyboard-42-3",
        uri: "file:///cache/openpost/rich-content/not-an-image",
        mimeType: "text/plain",
        filename: "not-an-image",
        size: 12,
      }),
    ).toBeNull();
  });
});
