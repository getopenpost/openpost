import type { ProjectSnapshot, SnapshotMediaReference } from '../project-bundle/snapshot-types';
import { PROJECT_SNAPSHOT_VERSION } from '../project-bundle/snapshot-types';
import { computeSnapshotChecksum } from '../project-bundle/snapshot-utils';
import {
	createBundleExportService,
	type BundleExportRuntime
} from '../project-bundle/bundle-export';
import { sanitizeBundleFileName, throwIfBundleAborted } from '../project-bundle/bundle-utils';
import type {
	BundleExportResult,
	BundleOutput,
	BundleProgress
} from '../project-bundle/bundle-types';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import type { Project } from '../project/types';
import type { CloudVideoProjectRepository } from './project-repository';
import { m } from '$lib/paraglide/messages';

function mediaReference(media: MediaMetadata): SnapshotMediaReference {
	return {
		id: media.id,
		fileName: media.fileName,
		fileSize: media.fileSize,
		mimeType: media.mimeType,
		...(media.contentHash && { contentHash: media.contentHash }),
		duration: media.duration,
		width: media.width,
		height: media.height,
		fps: media.fps
	};
}

export function createCloudBundleRuntime(
	repository: CloudVideoProjectRepository<Project>
): BundleExportRuntime {
	const mediaByProject = new Map<string, Promise<MediaMetadata[]>>();
	const media = (projectId: string) => {
		const existing = mediaByProject.get(projectId);
		if (existing) return existing;
		const loading = repository.listMedia(projectId);
		mediaByProject.set(projectId, loading);
		return loading;
	};
	return {
		exportSnapshot: async (projectId): Promise<ProjectSnapshot> => {
			const [cloudProject, projectMedia] = await Promise.all([
				repository.get(projectId),
				media(projectId)
			]);
			const snapshot: ProjectSnapshot = {
				version: PROJECT_SNAPSHOT_VERSION,
				exportedAt: new Date().toISOString(),
				editorVersion: 'OpenPost',
				project: structuredClone(cloudProject.document),
				mediaReferences: projectMedia.map(mediaReference)
			};
			snapshot.checksum = await computeSnapshotChecksum(snapshot);
			return snapshot;
		},
		getProjectMediaIds: async (projectId) => (await media(projectId)).map((item) => item.id),
		getMedia: async (mediaId) => {
			for (const projectMedia of mediaByProject.values()) {
				const found = (await projectMedia).find((item) => item.id === mediaId);
				if (found) return found;
			}
			return undefined;
		},
		resolveMediaBlob,
		readProjectThumbnail: async () => null
	};
}

export async function saveCloudProjectBundle(
	repository: CloudVideoProjectRepository<Project>,
	projectId: string,
	projectName: string,
	onProgress?: (progress: BundleProgress) => void,
	signal?: AbortSignal
): Promise<BundleExportResult> {
	throwIfBundleAborted(signal);
	const fileName = sanitizeBundleFileName(projectName);
	const exporter = createBundleExportService(createCloudBundleRuntime(repository));
	if (window.showSaveFilePicker) {
		const handle = await window.showSaveFilePicker({
			suggestedName: fileName,
			types: [
				{
					description: m.video_editor_project_bundle_file_type(),
					accept: { 'application/zip': ['.zip'] }
				}
			]
		});
		const writable = await handle.createWritable();
		const output: BundleOutput = {
			write: (chunk) => writable.write(chunk as Uint8Array<ArrayBuffer>),
			close: () => writable.close(),
			abort: (reason) => writable.abort(reason)
		};
		return exporter.exportProjectBundle(projectId, output, onProgress, signal);
	}

	const chunks: Uint8Array<ArrayBuffer>[] = [];
	const output: BundleOutput = {
		write: async (chunk) => {
			const owned = new Uint8Array(chunk.byteLength);
			owned.set(chunk);
			chunks.push(owned);
		},
		close: async () => undefined,
		abort: async () => {
			chunks.length = 0;
		}
	};
	const result = await exporter.exportProjectBundle(projectId, output, onProgress, signal);
	const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = result.fileName;
	link.style.display = 'none';
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}
	return result;
}
