import * as FileSystem from "expo-file-system/legacy";

import { api, errorMessage, type Api } from "./api/client";

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
  const {
    data: session,
    error,
    response,
  } = await client.POST("/media/upload-session", {
    body: {
      workspace_id: workspaceId,
      filename: file.filename,
      size: file.size ?? 0,
      mime_type: file.mimeType,
      asset_kind: "library",
      source: file.localId.startsWith("camera:") ? "camera" : "upload",
    },
  });
  if (error || !session) throw new Error(await errorMessage(response, "Upload failed to start"));

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
    throw new Error(await errorMessage(completeResponse, "Upload could not be finalized"));
  }

  return session.media_id;
}
