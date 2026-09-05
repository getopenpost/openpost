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

export interface CapturedVideoProjectInput {
  id: string;
  name: string;
  fileName: string;
  durationSeconds: number;
  width: number;
  height: number;
  preparation: ProjectAssetPreparation;
  createdAt?: number;
}

const CAPTURE_PROJECT_FPS = 30;
const CAPTURE_PROJECT_SCHEMA_VERSION = 6;

function normalizedCropEdge(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1_000_000) / 1_000_000));
}

export function createCapturedVideoProjectDocument(input: CapturedVideoProjectInput) {
  const createdAt = input.createdAt ?? Date.now();
  const durationSeconds =
    Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : Math.max(1, input.preparation.source_range?.end_seconds ?? 1);
  const sourceWidth = Number.isFinite(input.width) && input.width > 0 ? input.width : 1920;
  const sourceHeight = Number.isFinite(input.height) && input.height > 0 ? input.height : 1080;
  const sourceDuration = Math.max(1, Math.round(durationSeconds * CAPTURE_PROJECT_FPS));
  const requestedStart = input.preparation.source_range?.start_seconds ?? 0;
  const requestedEnd = input.preparation.source_range?.end_seconds ?? durationSeconds;
  const sourceStart = Math.max(
    0,
    Math.min(sourceDuration - 1, Math.round(requestedStart * CAPTURE_PROJECT_FPS)),
  );
  const sourceEnd = Math.max(
    sourceStart + 1,
    Math.min(sourceDuration, Math.round(requestedEnd * CAPTURE_PROJECT_FPS)),
  );
  const crop = input.preparation.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const croppedWidth = Math.max(1, Math.round(sourceWidth * crop.width));
  const croppedHeight = Math.max(1, Math.round(sourceHeight * crop.height));
  const quarterTurn = input.preparation.rotation === 90 || input.preparation.rotation === 270;
  const canvasWidth = quarterTurn ? croppedHeight : croppedWidth;
  const canvasHeight = quarterTurn ? croppedWidth : croppedHeight;

  return {
    id: input.id,
    name: input.name,
    description: "",
    createdAt,
    updatedAt: createdAt,
    duration: (sourceEnd - sourceStart) / CAPTURE_PROJECT_FPS,
    schemaVersion: CAPTURE_PROJECT_SCHEMA_VERSION,
    schemaFamily: "openpost" as const,
    thumbnailId: input.id,
    metadata: {
      width: canvasWidth,
      height: canvasHeight,
      fps: CAPTURE_PROJECT_FPS,
      backgroundColor: "#000000",
    },
    timeline: {
      tracks: [
        {
          id: "track-video-main",
          name: "Video",
          kind: "video" as const,
          height: 96,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          volume: 1,
          order: 0,
        },
        {
          id: "track-audio",
          name: "Audio",
          kind: "audio" as const,
          height: 72,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          volume: 1,
          order: 1,
        },
      ],
      items: [
        {
          id: `clip-${input.id}`,
          trackId: "track-video-main",
          from: 0,
          durationInFrames: sourceEnd - sourceStart,
          label: input.fileName,
          type: "video" as const,
          mediaId: input.id,
          sourceStart,
          sourceEnd,
          sourceDuration,
          sourceFps: CAPTURE_PROJECT_FPS,
          sourceWidth,
          sourceHeight,
          transform: {
            x: 0,
            y: 0,
            width: croppedWidth,
            height: croppedHeight,
            rotation: input.preparation.rotation ?? 0,
          },
          crop: {
            top: normalizedCropEdge(crop.y),
            right: normalizedCropEdge(1 - crop.x - crop.width),
            bottom: normalizedCropEdge(1 - crop.y - crop.height),
            left: normalizedCropEdge(crop.x),
          },
          volume: input.preparation.muted ? 0 : (input.preparation.gain ?? 1),
        },
      ],
      transitions: [],
    },
    animationPresets: [],
  };
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
  // SAFETY: stripDeviceState preserves the input object's shape while removing device-only keys recursively.
  return stripDeviceState(structuredClone(document)) as T;
}

const STABLE_TIMELINE_COLLECTIONS = new Set(["tracks", "items", "transitions", "compositions"]);

/**
 * Build mutations at the smallest stable authored entity/property boundary.
 * Collection membership and ordering remain one operation because those edits
 * affect a shared timeline region. Property edits on existing IDs can rebase
 * independently across devices.
 */
export function videoProjectMutationOperations(
  previousDocument: object,
  nextDocument: object,
): VideoProjectMutationOperation[] {
  const previous = portableVideoProjectDocument(previousDocument);
  const next = portableVideoProjectDocument(nextDocument);
  const operations: VideoProjectMutationOperation[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of [...keys].sort()) {
    const before = Reflect.get(previous, key);
    const after = Reflect.get(next, key);
    if (key === "timeline" && isRecord(before) && isRecord(after)) {
      diffTimeline(before, after, operations);
      continue;
    }
    appendValueMutation(operations, before, after, `project:${key}`, `/${pointer(key)}`);
  }
  return operations;
}

function diffTimeline(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  operations: VideoProjectMutationOperation[],
): void {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of [...keys].sort()) {
    const before = previous[key];
    const after = next[key];
    if (STABLE_TIMELINE_COLLECTIONS.has(key) && Array.isArray(before) && Array.isArray(after)) {
      diffStableCollection(before, after, key, operations);
      continue;
    }
    appendValueMutation(operations, before, after, `timeline:${key}`, `/timeline/${pointer(key)}`);
  }
}

function diffStableCollection(
  previous: unknown[],
  next: unknown[],
  collection: string,
  operations: VideoProjectMutationOperation[],
): void {
  const previousRecords = previous.every(hasStableId) ? previous : null;
  const nextRecords = next.every(hasStableId) ? next : null;
  const stableOrder =
    previousRecords !== null &&
    nextRecords !== null &&
    previous.length === next.length &&
    previousRecords.every((entry, index) => entry.id === nextRecords[index]?.id);
  if (!stableOrder || !previousRecords || !nextRecords) {
    appendValueMutation(
      operations,
      previous,
      next,
      `timeline:${collection}`,
      `/timeline/${pointer(collection)}`,
    );
    return;
  }

  const singular = collection.endsWith("s") ? collection.slice(0, -1) : collection;
  for (let index = 0; index < nextRecords.length; index += 1) {
    const before = previousRecords[index];
    const after = nextRecords[index];
    if (!before || !after) continue;
    diffRecord(
      before,
      after,
      `${singular}:${after.id}`,
      `/timeline/${pointer(collection)}/${index}`,
      operations,
    );
  }
}

function diffRecord(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  target: string,
  path: string,
  operations: VideoProjectMutationOperation[],
): void {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of [...keys].sort()) {
    if (key === "id") continue;
    const before = previous[key];
    const after = next[key];
    if (isRecord(before) && isRecord(after)) {
      diffRecord(before, after, `${target}.${key}`, `${path}/${pointer(key)}`, operations);
      continue;
    }
    appendValueMutation(operations, before, after, `${target}.${key}`, `${path}/${pointer(key)}`);
  }
}

function appendValueMutation(
  operations: VideoProjectMutationOperation[],
  previous: unknown,
  next: unknown,
  target: string,
  path: string,
): void {
  if (sameJsonValue(previous, next)) return;
  if (next === undefined) {
    operations.push({ kind: "delete", target, path: path as `/${string}` });
    return;
  }
  operations.push({
    kind: "set",
    target,
    path: path as `/${string}`,
    value: next,
  });
}

function hasStableId(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
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
                  ? {
                      ...entry,
                      batch: { ...entry.batch, base_revision: result.revision },
                    }
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
