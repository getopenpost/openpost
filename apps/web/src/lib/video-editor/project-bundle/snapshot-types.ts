import type { Project } from '../project/types';

export const PROJECT_SNAPSHOT_VERSION = '1.0';
export const PROJECT_SNAPSHOT_EXTENSION = '.openpost.json';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SnapshotMediaReference {
	id: string;
	fileName: string;
	fileSize: number;
	mimeType: string;
	contentHash?: string;
	duration: number;
	width: number;
	height: number;
	fps: number;
}

export interface ProjectSnapshot {
	version: typeof PROJECT_SNAPSHOT_VERSION;
	exportedAt: string;
	editorVersion: string;
	project: Project;
	mediaReferences: SnapshotMediaReference[];
	checksum?: string;
}

export interface SnapshotValidationResult {
	snapshot?: ProjectSnapshot;
	errors: string[];
}

export interface SnapshotImportResult {
	project: Project;
	matchedMedia: number;
	unmatchedMedia: SnapshotMediaReference[];
	warnings: string[];
}
