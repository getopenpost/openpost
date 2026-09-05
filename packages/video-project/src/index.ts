export const VIDEO_PROJECT_DOCUMENT_VERSION = 1;

export type VideoProjectSyncStatus =
  | "pending"
  | "uploading"
  | "saving"
  | "synced"
  | "needs_attention";

export type ProjectAssetStatus = "pending" | "uploading" | "ready" | "needs_storage" | "failed";

export interface PortableVideoProjectDocument {
  id: string;
  schemaVersion?: number;
  name?: string;
  timeline: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VideoProjectMutationOperation {
  kind: "set" | "delete";
  target: string;
  path: `/${string}`;
  value?: unknown;
}

export interface VideoProjectMutationBatch {
  workspace_id: string;
  mutation_id: string;
  base_revision: number;
  device_id?: string;
  operations: VideoProjectMutationOperation[];
}

export interface ProjectAssetPreparation {
  source_range?: { start_seconds: number; end_seconds: number };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: 0 | 90 | 180 | 270;
  gain?: number;
  muted?: boolean;
  cover_frame_seconds?: number;
}

export interface PendingVideoProjectMutation {
  projectId: string;
  batch: VideoProjectMutationBatch;
  queuedAt: number;
  attempts: number;
}

export interface MutationOutboxStorage {
  load(): Promise<PendingVideoProjectMutation[]>;
  save(entries: PendingVideoProjectMutation[]): Promise<void>;
}

export type MutationDeliveryResult =
  | { outcome: "applied"; revision: number }
  | { outcome: "conflict"; revision: number; conflictId: string };

const DEVICE_ONLY_KEYS = new Set([
  "rootFolderHandle",
  "rootFolderName",
  "currentFrame",
  "zoomLevel",
  "scrollPosition",
  "selection",
  "selections",
  "panelLayout",
]);

export function portableVideoProjectDocument<T extends object>(document: T): T {
  return stripDeviceState(structuredClone(document)) as T;
}

function stripDeviceState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDeviceState);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DEVICE_ONLY_KEYS.has(key))
      .map(([key, child]) => [key, stripDeviceState(child)]),
  );
}

export function touchedTargets(batch: VideoProjectMutationBatch): string[] {
  return [
    ...new Set(batch.operations.map((operation) => operation.target.trim()).filter(Boolean)),
  ].sort();
}

export function overlappingTargets(
  local: VideoProjectMutationBatch,
  remoteTargets: readonly string[],
): string[] {
  const remote = new Set(remoteTargets);
  return touchedTargets(local).filter((target) => remote.has(target));
}

export class VideoProjectMutationOutbox {
  private draining: Promise<MutationDeliveryResult[]> | null = null;

  constructor(private readonly storage: MutationOutboxStorage) {}

  async enqueue(entry: PendingVideoProjectMutation): Promise<void> {
    const current = await this.storage.load();
    if (current.some((candidate) => candidate.batch.mutation_id === entry.batch.mutation_id))
      return;
    await this.storage.save([...current, entry]);
  }

  drain(
    deliver: (entry: PendingVideoProjectMutation) => Promise<MutationDeliveryResult>,
  ): Promise<MutationDeliveryResult[]> {
    if (!this.draining) {
      this.draining = this.drainOnce(deliver).finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainOnce(
    deliver: (entry: PendingVideoProjectMutation) => Promise<MutationDeliveryResult>,
  ): Promise<MutationDeliveryResult[]> {
    const results: MutationDeliveryResult[] = [];
    while (true) {
      const [next, ...rest] = await this.storage.load();
      if (!next) return results;
      try {
        const result = await deliver(next);
        results.push(result);
        const rebased =
          result.outcome === "applied"
            ? rest.map((entry) =>
                entry.projectId === next.projectId
                  ? { ...entry, batch: { ...entry.batch, base_revision: result.revision } }
                  : entry,
              )
            : rest;
        await this.storage.save(rebased);
      } catch (error) {
        await this.storage.save([{ ...next, attempts: next.attempts + 1 }, ...rest]);
        throw error;
      }
    }
  }
}
