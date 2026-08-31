import type { ShareIntentFile } from "expo-share-intent";

import type { PendingAttachment } from "./media";

/** Files shared from other apps, waiting to be picked up by the composer. */
let pendingAttachments: PendingAttachment[] = [];

export function stashPendingAttachments(files: PendingAttachment[]): void {
  pendingAttachments = files.map((file) => ({ ...file }));
}

export function stashSharedFiles(files: ShareIntentFile[]): void {
  stashPendingAttachments(
    files
      .filter((file) => file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/"))
      .map((file, index) => ({
        localId: `shared-${Date.now()}-${index}`,
        uri: file.path,
        mimeType: file.mimeType,
        filename: file.fileName || `shared-${index + 1}`,
        size: file.size,
      })),
  );
}

export function takePendingAttachments(): PendingAttachment[] {
  const stash = pendingAttachments;
  pendingAttachments = [];
  return stash;
}
