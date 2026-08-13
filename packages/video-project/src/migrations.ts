import {
  VIDEO_PROJECT_SCHEMA_VERSION,
  type VideoProjectDocumentV1,
} from "./types.js";
import { assertValidVideoProject } from "./validation.js";

export interface VideoProjectMigrationResult {
  document: VideoProjectDocumentV1;
  migrated: boolean;
  sourceVersion: number;
}

export function migrateVideoProjectDocument(
  input: unknown,
): VideoProjectMigrationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("OpenPost Video Editor project data must be a JSON object.");
  }
  const sourceVersion = Number(
    (input as Record<string, unknown>).schema_version,
  );
  if (sourceVersion !== VIDEO_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `OpenPost Video Editor project schema ${String(sourceVersion)} is not supported.`,
    );
  }

  const normalized = structuredClone(input) as Record<string, unknown>;
  if (normalized.editing_mode === "studio") {
    normalized.editing_mode = "editor";
  }
  for (const field of [
    "primary_sequence",
    "visual_tracks",
    "audio_tracks",
    "caption_tracks",
    "variants",
    "markers",
  ]) {
    if (normalized[field] === null) normalized[field] = [];
  }
  if (normalized.sources === null) normalized.sources = {};

  return {
    document: assertValidVideoProject(normalized),
    migrated: JSON.stringify(normalized) !== JSON.stringify(input),
    sourceVersion,
  };
}
