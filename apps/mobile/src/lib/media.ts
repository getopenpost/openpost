import * as FileSystem from "expo-file-system/legacy";

import { api, errorMessage, type Api } from "./api/client";

export const MAX_MOBILE_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const ORIGINAL_IMAGE_QUALITY = 1;

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
  { client = api(), workspaceId }: { client?: Api; workspaceId: string },
): Promise<string> {
  const localFile = await FileSystem.getInfoAsync(file.uri);
  if (!localFile.exists || localFile.isDirectory) {
    throw new Error("This attachment is no longer available. Choose it again.");
  }
  // Android picker metadata can describe the original instead of its compressed copy.
  const size = localFile.size;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("This attachment is empty or its size could not be read.");
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachments must be 50 MB or smaller.");
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
      source: file.localId.startsWith("camera:") ? "camera" : "upload",
    },
  });
  if (error || !session)
    throw new Error(await errorMessage(response, "Upload failed to start", error));

  if (!session.deduped) {
    const uploadResult = await FileSystem.uploadAsync(session.upload.url, file.uri, {
      httpMethod: session.upload.method.toUpperCase() as "PUT" | "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: session.upload.headers,
    });
    if (uploadResult.status >= 400) {
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

  return session.media_id;
}
