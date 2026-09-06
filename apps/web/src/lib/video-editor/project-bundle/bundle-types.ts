import type { MediaMetadata } from '../media/types';

export const PROJECT_BUNDLE_VERSION = '1.0';
export const PROJECT_BUNDLE_EXTENSION = '.openpost.zip';
export const PROJECT_BUNDLE_MANIFEST_PATH = 'manifest.json';
export const PROJECT_BUNDLE_SNAPSHOT_PATH = 'project.openpost.json';
export const PROJECT_BUNDLE_COVER_PATH = 'cover.jpg';

export interface BundleFileEntry {
	relativePath: string;
	fileSize: number;
	sha256: string;
}

export interface BundleMediaEntry extends BundleFileEntry {
	originalId: string;
	fileName: string;
	mimeType: string;
	metadata: Pick<
		MediaMetadata,
		| 'duration'
		| 'width'
		| 'height'
		| 'fps'
		| 'codec'
		| 'bitrate'
		| 'audioCodec'
		| 'audioCodecSupported'
		| 'videoCodecSupported'
		| 'keyframeTimestamps'
		| 'gopInterval'
		| 'lottieTotalFrames'
		| 'lottieMarkers'
		| 'attribution'
		| 'tags'
	>;
}

export interface ProjectBundleManifest {
	version: typeof PROJECT_BUNDLE_VERSION;
	createdAt: string;
	editorVersion: string;
	projectId: string;
	projectName: string;
	project: BundleFileEntry;
	media: BundleMediaEntry[];
	cover?: BundleFileEntry;
	checksum: string;
}

export type BundleProgressStage =
	| 'collecting'
	| 'hashing'
	| 'packaging'
	| 'validating'
	| 'extracting'
	| 'linking'
	| 'complete';

export interface BundleProgress {
	stage: BundleProgressStage;
	percent: number;
	currentFile?: string;
	completedBytes?: number;
	totalBytes?: number;
}

export interface BundleExportResult {
	fileName: string;
	size: number;
	mediaCount: number;
}

export interface BundleImportResult {
	projectId: string;
	projectName: string;
	mediaImported: number;
	mediaReused: number;
}

export interface BundleOutput {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
	abort(reason?: Error): Promise<void>;
}

export interface BundleMediaWriter {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
	abort(reason?: Error): Promise<void>;
}
