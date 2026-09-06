import { createCapturedVideoProjectDocumentFromAssets } from '@openpost/video-project';
import { uploadMediaFile } from '$lib/media-upload-client';
import type { CaptureArtifact, RecorderKind } from '../recorder/recorder.svelte';
import type { RecordingImportRuntime } from '../recorder/insert-recording';
import { hashBlob } from '../project-bundle/bundle-utils';
import { probeMediaFile } from '../media/probe-client';
import { importCloudProjectAssetFile } from './import-project-assets';
import { CloudVideoProjectRepository } from './project-repository';

export type RecorderCloudDocument = ReturnType<typeof createCapturedVideoProjectDocumentFromAssets>;

export interface RecorderCloudRepository {
	readonly workspaceId: string;
	createWithId(id: string, name: string, document: RecorderCloudDocument): Promise<{ id: string }>;
	reserveAsset(
		projectId: string,
		input: {
			stableMediaId: string;
			fileName: string;
			mimeType: string;
			size: number;
			sha256: string;
		}
	): Promise<string>;
}

export interface RecorderCloudRuntime {
	now(): Date;
	id(): string;
	hash(file: File): Promise<string>;
	probe(file: File): Promise<{ duration: number; width: number; height: number }>;
	upload(input: {
		workspaceId: string;
		projectAssetId: string;
		file: File;
		sha256: string;
	}): Promise<void>;
}

const defaultRuntime: RecorderCloudRuntime = {
	now: () => new Date(),
	id: () => crypto.randomUUID(),
	hash: hashBlob,
	async probe(file) {
		const metadata = await probeMediaFile(file);
		return {
			duration: metadata.durationSeconds,
			width: metadata.width,
			height: metadata.height
		};
	},
	async upload(input) {
		await uploadMediaFile({
			workspaceId: input.workspaceId,
			file: input.file,
			source: 'video_editor_source',
			assetKind: 'project_asset',
			retentionClass: 'temporary',
			projectAssetId: input.projectAssetId,
			clientSHA256: input.sha256,
			prepareVideo: false
		});
	}
};

function extension(mimeType: string): string {
	if (mimeType.includes('ogg')) return 'ogg';
	if (mimeType.includes('mp4')) return 'mp4';
	return 'webm';
}

function artifactFile(artifact: CaptureArtifact, timestamp: string): File {
	return new File(
		[artifact.blob],
		`recording-${artifact.kind}-${timestamp}.${extension(artifact.mimeType)}`,
		{ type: artifact.mimeType || artifact.blob.type, lastModified: Date.now() }
	);
}

function projectName(now: Date): string {
	return `Recording ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
}

function preparation(kind: RecorderKind) {
	return { muted: false, gain: kind === 'microphone' ? 1 : undefined };
}

export async function saveRecorderArtifactsToCloud(
	repository: RecorderCloudRepository,
	artifacts: CaptureArtifact[],
	runtime: RecorderCloudRuntime = defaultRuntime
): Promise<{ projectId: string; name: string }> {
	if (artifacts.length === 0) throw new Error('A recording needs at least one captured source');
	const now = runtime.now();
	const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const projectId = runtime.id();
	const name = projectName(now);
	const prepared = await Promise.all(
		artifacts.map(async (artifact) => {
			const id = runtime.id();
			const file = artifactFile(artifact, timestamp);
			const [sha256, metadata] = await Promise.all([runtime.hash(file), runtime.probe(file)]);
			return { artifact, id, file, sha256, metadata };
		})
	);
	const document = createCapturedVideoProjectDocumentFromAssets({
		id: projectId,
		name,
		createdAt: now.getTime(),
		assets: prepared.map(({ artifact, id, file, metadata }) => ({
			id,
			kind: artifact.kind,
			fileName: file.name,
			durationSeconds: metadata.duration || artifact.durationMs / 1000,
			startOffsetSeconds: artifact.startOffsetMs / 1000,
			width: metadata.width,
			height: metadata.height,
			preparation: preparation(artifact.kind)
		}))
	});
	await repository.createWithId(projectId, name, document);
	for (const asset of prepared) {
		const projectAssetId = await repository.reserveAsset(projectId, {
			stableMediaId: asset.id,
			fileName: asset.file.name,
			mimeType: asset.file.type || 'application/octet-stream',
			size: asset.file.size,
			sha256: asset.sha256
		});
		await runtime.upload({
			workspaceId: repository.workspaceId,
			projectAssetId,
			file: asset.file,
			sha256: asset.sha256
		});
	}
	return { projectId, name };
}

export function recorderCloudRepository(workspaceId: string): RecorderCloudRepository {
	return new CloudVideoProjectRepository<RecorderCloudDocument>(workspaceId);
}

export function createCloudRecordingImportRuntime<TDocument extends object>(
	repository: CloudVideoProjectRepository<TDocument>
): RecordingImportRuntime {
	async function importFile(
		file: File,
		options: {
			projectId: string;
			tags?: string[];
			capture?: Parameters<RecordingImportRuntime['importVideo']>[1]['capture'];
		}
	) {
		const media = await importCloudProjectAssetFile({
			projectId: options.projectId,
			repository,
			file,
			tags: options.tags,
			capture: options.capture,
			onUnsupportedAudio: async () => 'import'
		});
		if (!media) throw new Error('Could not import the recording into this Cloud Video Project');
		return media;
	}

	return {
		importVideo: importFile,
		importAudio: importFile,
		rollback: async () => undefined
	};
}
