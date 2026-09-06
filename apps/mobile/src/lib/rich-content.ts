import type { PendingAttachment } from "./media";

export type RichContentImagePayload = {
  localId?: string;
  uri?: string;
  mimeType?: string;
  filename?: string;
  size?: number | null;
};

function imageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".jpg";
  }
}

function safeFilename(filename: string | undefined, mimeType: string): string {
  const basename = filename?.trim().split(/[\\/]/).pop()?.trim();
  return basename || `keyboard-image${imageExtension(mimeType)}`;
}

export function pendingAttachmentFromRichContentImage(
  payload: RichContentImagePayload,
): PendingAttachment | null {
  const localId = payload.localId?.trim();
  const uri = payload.uri?.trim();
  const mimeType = payload.mimeType?.trim().toLowerCase();
  if (!localId || !uri || !mimeType?.startsWith("image/")) return null;

  const size =
    typeof payload.size === "number" && Number.isFinite(payload.size) && payload.size >= 0
      ? payload.size
      : null;

  return {
    localId,
    uri,
    mimeType,
    filename: safeFilename(payload.filename, mimeType),
    size,
  };
}
