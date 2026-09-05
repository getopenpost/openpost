import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { File } from "expo-file-system";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createCapturedVideoProjectDocument,
  type ProjectAssetPreparation,
} from "@openpost/video-project";

import { api, errorMessage } from "./api/client";
import { videoProjectUploadAvailability } from "./video-project-upload-policy";
import { getAllowCellularVideoUploads } from "./video-project-upload-preferences";

const CAPTURE_QUEUE_DIRECTORY = `${FileSystem.documentDirectory ?? ""}video-project-captures`;
const CAPTURE_QUEUE_FILE = `${CAPTURE_QUEUE_DIRECTORY}/queue.json`;

export type MobileVideoProject = {
  id: string;
  name: string;
  sync_status: "pending" | "uploading" | "saving" | "synced" | "needs_attention";
  attention_reason?: string;
  updated_at: string;
};

export type VideoCaptureAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
  duration?: number | null;
  width: number;
  height: number;
};

type PendingCapture = {
  id: string;
  workspaceId: string;
  name: string;
  uri: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  durationSeconds: number;
  width: number;
  height: number;
  preparation: ProjectAssetPreparation;
  queuedAt: number;
};

async function readQueue(): Promise<PendingCapture[]> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(CAPTURE_QUEUE_FILE)) as PendingCapture[];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingCapture[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(CAPTURE_QUEUE_DIRECTORY, { intermediates: true });
  await FileSystem.writeAsStringAsync(CAPTURE_QUEUE_FILE, JSON.stringify(queue));
}

export async function listMobileVideoProjects(workspaceId: string): Promise<MobileVideoProject[]> {
  const { data, error, response } = await api().GET("/video-projects", {
    params: { query: { workspace_id: workspaceId } },
  });
  if (error || !data)
    throw new Error(await errorMessage(response, "Could not load Video Projects"));
  return data;
}

export async function queueVideoCapture(
  workspaceId: string,
  asset: VideoCaptureAsset,
  preparation: ProjectAssetPreparation,
): Promise<void> {
  const id = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await FileSystem.makeDirectoryAsync(CAPTURE_QUEUE_DIRECTORY, { intermediates: true });
  const extension = asset.fileName?.split(".").pop() || "mp4";
  const uri = `${CAPTURE_QUEUE_DIRECTORY}/${id}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: uri });
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || typeof info.size !== "number" || info.size <= 0) {
    throw new Error("The captured video could not be read");
  }
  const queue = await readQueue();
  const contentHash = await fileSHA256(uri);
  await writeQueue([
    ...queue,
    {
      id,
      workspaceId,
      name: asset.fileName?.replace(/\.[^.]+$/, "") || "Mobile capture",
      uri,
      filename: asset.fileName || `${id}.${extension}`,
      mimeType: asset.mimeType || "video/mp4",
      size: info.size,
      sha256: contentHash,
      durationSeconds: Math.max(0, (asset.duration ?? 0) / 1000),
      width: asset.width,
      height: asset.height,
      preparation,
      queuedAt: Date.now(),
    },
  ]);
}

export async function pendingVideoCaptureCount(workspaceId: string): Promise<number> {
  return (await readQueue()).filter((entry) => entry.workspaceId === workspaceId).length;
}

export async function purgeVideoProjectDeviceData(): Promise<void> {
  await FileSystem.deleteAsync(CAPTURE_QUEUE_DIRECTORY, { idempotent: true });
}

export class VideoProjectUploadDeferredError extends Error {
  constructor(readonly reason: "offline" | "wifi_required") {
    super(
      reason === "wifi_required"
        ? "Upload is waiting for Wi-Fi. Enable cellular uploads to continue now."
        : "Upload is waiting for a connection.",
    );
    this.name = "VideoProjectUploadDeferredError";
  }
}

export async function syncPendingVideoCaptures(
  workspaceId: string,
  networkState?: Network.NetworkState,
): Promise<number> {
  const network = networkState ?? (await Network.getNetworkStateAsync());
  const availability = videoProjectUploadAvailability(
    network,
    await getAllowCellularVideoUploads(),
  );
  if (availability !== "allowed") throw new VideoProjectUploadDeferredError(availability);
  const queue = await readQueue();
  const remaining = [...queue];
  let synced = 0;
  for (const capture of queue) {
    if (capture.workspaceId !== workspaceId) continue;
    await uploadCapture(capture);
    const index = remaining.findIndex((entry) => entry.id === capture.id);
    if (index >= 0) remaining.splice(index, 1);
    await writeQueue(remaining);
    await FileSystem.deleteAsync(capture.uri, { idempotent: true });
    synced += 1;
  }
  return synced;
}

async function uploadCapture(capture: PendingCapture): Promise<void> {
  const client = api();
  const contentHash = capture.sha256 || (await fileSHA256(capture.uri));
  const created = await client.POST("/video-projects", {
    body: {
      id: capture.id,
      workspace_id: capture.workspaceId,
      name: capture.name,
      device_id: "mobile",
      document: createCapturedVideoProjectDocument({
        id: capture.id,
        name: capture.name,
        fileName: capture.filename,
        durationSeconds: capture.durationSeconds,
        width: capture.width,
        height: capture.height,
        preparation: capture.preparation,
        createdAt: capture.queuedAt,
      }),
    },
  });
  if (created.error || !created.data) {
    throw new Error(await errorMessage(created.response, "Could not create Video Project"));
  }
  const reserved = await client.POST("/video-projects/{id}/assets", {
    params: { path: { id: created.data.id } },
    body: {
      workspace_id: capture.workspaceId,
      stable_media_id: capture.id,
      original_filename: capture.filename,
      mime_type: capture.mimeType,
      size: capture.size,
      sha256: contentHash,
      device_id: "mobile",
      preparation: { ...capture.preparation },
    },
  });
  if (reserved.error || !reserved.data) {
    throw new Error(await errorMessage(reserved.response, "Could not prepare Project Asset"));
  }
  await client.POST("/video-projects/{id}/assets/{asset_id}/begin-upload", {
    params: { path: { id: created.data.id, asset_id: reserved.data.id } },
    body: { workspace_id: capture.workspaceId },
  });
  const session = await client.POST("/media/upload-session", {
    body: {
      workspace_id: capture.workspaceId,
      filename: capture.filename,
      mime_type: capture.mimeType,
      size: capture.size,
      source: "camera",
      asset_kind: "project_asset",
      project_asset_id: reserved.data.id,
      client_sha256: contentHash,
    },
  });
  if (session.error || !session.data) {
    throw new Error(await errorMessage(session.response, "Could not start Project Asset upload"));
  }
  if (!session.data.deduped) {
    const uploaded = await FileSystem.uploadAsync(session.data.upload.url, capture.uri, {
      httpMethod: session.data.upload.method.toUpperCase() as "PUT" | "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: session.data.upload.headers,
    });
    if (uploaded.status >= 400) throw new Error(`Project Asset upload failed (${uploaded.status})`);
  }
  const complete = await client.POST("/media/upload-session/{id}/complete", {
    params: { path: { id: session.data.media_id } },
    body: { workspace_id: capture.workspaceId },
  });
  if (complete.error) {
    throw new Error(await errorMessage(complete.response, "Could not finish Project Asset upload"));
  }
}

async function fileSHA256(uri: string): Promise<string> {
  const hasher = sha256.create();
  const reader = new File(uri).readableStream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytesToHex(hasher.digest());
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
}
