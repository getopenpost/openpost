import { afterEach, describe, expect, test } from "bun:test";

import { stashPendingAttachments, stashSharedFiles, takePendingAttachments } from "./share";

afterEach(() => {
  takePendingAttachments();
});

describe("pending composer attachments", () => {
  test("carries a selected image into the next composer exactly once", () => {
    const attachments = [
      {
        localId: "local-1",
        uri: "file:///photo.jpg",
        mimeType: "image/jpeg",
        filename: "photo.jpg",
        size: 42,
      },
    ];

    stashPendingAttachments(attachments);

    expect(takePendingAttachments()).toEqual(attachments);
    expect(takePendingAttachments()).toEqual([]);
  });

  test("keeps only share-intent media that the composer accepts", () => {
    stashSharedFiles([
      {
        path: "file:///photo.png",
        fileName: "photo.png",
        mimeType: "image/png",
        size: 10,
        width: 100,
        height: 100,
        duration: null,
      },
      {
        path: "file:///notes.txt",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 20,
        width: null,
        height: null,
        duration: null,
      },
    ]);

    expect(takePendingAttachments()).toEqual([
      {
        localId: expect.stringMatching(/^shared-/),
        uri: "file:///photo.png",
        mimeType: "image/png",
        filename: "photo.png",
        size: 10,
      },
    ]);
  });
});
