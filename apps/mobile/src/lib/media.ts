import { getServer } from "./server";
import { serverHeadersForUrl } from "./server-headers";
import { nativeTelemetry } from "./telemetry";
import * as FileSystem from "expo-file-system/legacy";

import {
  api,
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  errorMessage,
  type Api,
} from "./api/client";

export const MAX_MOBILE_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_ATTACHMENT_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_BRAND_FONT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ORIGINAL_IMAGE_QUALITY = 1;

export interface AttachmentLimits {
  videoBytes: number;
  defaultBytes: number;
  brandFontBytes?: number;
}

// Documented fallback while the served GET /media/storage upload_limits are
// unavailable (offline, older server, or not yet fetched). The server remains
// the enforcement boundary and rejects over-limit uploads regardless.
export const ATTACHMENT_SIZE_LIMITS: AttachmentLimits = {
  videoBytes: MAX_VIDEO_ATTACHMENT_BYTES,
  defaultBytes: MAX_ATTACHMENT_BYTES,
  brandFontBytes: MAX_BRAND_FONT_ATTACHMENT_BYTES,
};

/** Wire shape of the served GET /media/storage upload_limits. */
export interface MediaStorageUploadLimits {
  upload_limits?: {
    default_bytes?: number;
    video_bytes?: number;
    brand_font_bytes?: number;
  } | null;
}

function asLimitBytes(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

/**
 * Read the per-kind upload ceilings the server publishes on
 * GET /media/storage, falling back per field to the documented constants
 * when the response predates upload_limits. A stale limit only affects the
 * pre-flight message; the server still rejects at the boundary.
 */
export function attachmentLimitsFromStorage(
  body: MediaStorageUploadLimits | null | undefined,
): AttachmentLimits {
  const served = body?.upload_limits ?? null;
  return {
    videoBytes: asLimitBytes(served?.video_bytes, ATTACHMENT_SIZE_LIMITS.videoBytes),
    defaultBytes: asLimitBytes(served?.default_bytes, ATTACHMENT_SIZE_LIMITS.defaultBytes),
    brandFontBytes: asLimitBytes(
      served?.brand_font_bytes,
      ATTACHMENT_SIZE_LIMITS.brandFontBytes ?? MAX_BRAND_FONT_ATTACHMENT_BYTES,
    ),
  };
}

function formatAttachmentLimit(limit: number): string {
  if (limit >= 1024 * 1024 * 1024 && limit % (1024 * 1024 * 1024) === 0) {
    return `${limit / (1024 * 1024 * 1024)} GB`;
  }
  return `${Math.round(limit / (1024 * 1024))} MB`;
}

export function isVideoAttachment(mimeType: string, filename: string): boolean {
  if (mimeType.trim().toLowerCase().startsWith("video/")) return true;
  const dot = filename.toLowerCase().lastIndexOf(".");
  if (dot >= 0) {
    const ext = filename.toLowerCase().slice(dot);
    if (ext === ".mp4" || ext === ".mov" || ext === ".m4v" || ext === ".webm") return true;
  }
  return false;
}

export function attachmentSizeError(
  file: { mimeType: string; filename: string; size: number | null; assetKind?: string },
  limits: AttachmentLimits = ATTACHMENT_SIZE_LIMITS,
): string | null {
  if (file.size === null) return null;
  if (file.assetKind === "brand_font" && limits.brandFontBytes !== undefined) {
    if (file.size <= limits.brandFontBytes) return null;
    return `Brand fonts must be ${formatAttachmentLimit(limits.brandFontBytes)} or smaller.`;
  }
  const video = isVideoAttachment(file.mimeType, file.filename);
  const limit = video ? limits.videoBytes : limits.defaultBytes;
  if (file.size <= limit) return null;
  if (video) return `Videos must be ${formatAttachmentLimit(limit)} or smaller.`;
  return `Attachments must be ${formatAttachmentLimit(limit)} or smaller.`;
}

export type PendingAttachment = {
  localId: string;
  uri: string;
  mimeType: string;
  filename: string;
  size: number | null;
};

/**
 * Upload a local file through the direct-upload session flow:
 * create session → raw binary upload to the presigned target → complete.
 * Returns the final media id for attaching to publications/renditions.
 */
export async function uploadAttachment(
  file: PendingAttachment,
  {
    client = api(),
    workspaceId,
    source,
    altText,
    limits = ATTACHMENT_SIZE_LIMITS,
  }: {
    client?: Api;
    workspaceId: string;
    source?: "screenshot_template";
    altText?: string;
    /** Served GET /media/storage upload limits via attachmentLimitsFromStorage. */
    limits?: AttachmentLimits;
  },
): Promise<string> {
  const identity = captureApiRequestIdentity();
  const localFile = await FileSystem.getInfoAsync(file.uri);
  if (!localFile.exists || localFile.isDirectory) {
    throw new Error("This attachment is no longer available. Choose it again.");
  }
  // Android picker metadata can describe the original instead of its compressed copy.
  const size = localFile.size;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("This attachment is empty or its size could not be read.");
  }
  const sizeError = attachmentSizeError(
    { mimeType: file.mimeType, filename: file.filename, size },
    limits,
  );
  if (sizeError) {
    throw new Error(sizeError);
  }
  const {
    data: session,
    error,
    response,
  } = await client.POST("/media/upload-session", {
    body: {
      workspace_id: workspaceId,
      filename: file.filename,
      size,
      mime_type: file.mimeType,
      asset_kind: "library",
      source: source ?? (file.localId.startsWith("camera:") ? "camera" : "upload"),
      ...(altText ? { alt_text: altText } : {}),
    },
  });
  if (error || !session)
    throw new Error(await errorMessage(response, "Upload failed to start", error));

  if (!session.deduped) {
    const server = getServer();
    const proxyHeaders = serverHeadersForUrl(
      session.upload.url,
      server?.baseUrl ?? "",
      server?.headers ?? [],
    );
    const uploadResult = await FileSystem.uploadAsync(session.upload.url, file.uri, {
      httpMethod: session.upload.method.toUpperCase() as "PUT" | "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      followRedirects: Object.keys(proxyHeaders).length === 0,
      headers: {
        ...session.upload.headers,
        ...proxyHeaders,
      },
    });
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload failed (${uploadResult.status})`);
    }
  }

  const { error: completeError, response: completeResponse } = await client.POST(
    "/media/upload-session/{id}/complete",
    {
      params: { path: { id: session.media_id } },
      body: { workspace_id: workspaceId },
    },
  );
  if (completeError) {
    throw new Error(
      await errorMessage(completeResponse, "Upload could not be finalized", completeError),
    );
  }

  if (apiRequestIdentityIsCurrent(identity))
    nativeTelemetry.capture("media uploaded", {
      count: 1,
      source: file.localId.startsWith("camera:") ? "camera" : "upload",
    });
  return session.media_id;
}
