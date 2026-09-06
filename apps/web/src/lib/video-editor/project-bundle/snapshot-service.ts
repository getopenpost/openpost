import type { MediaMetadata } from '../media/types';
import { CURRENT_SCHEMA_VERSION, migrateProjectDocument } from '../project/defaults';
import { cloneProjectDocument } from '../project/project-clone';
import type { Project } from '../project/types';
import { associateMediaWithProject, getProjectMediaIds } from '../workspace-fs/project-media';
import { createProject, deleteProject, getProject } from '../workspace-fs/projects';
import { getAllMedia, getMedia } from '../workspace-fs/media';
import {
	PROJECT_SNAPSHOT_VERSION,
	type JsonValue,
	type ProjectSnapshot,
	type SnapshotImportResult,
	type SnapshotMediaReference
} from './snapshot-types';
import {
	computeSnapshotChecksum,
	sanitizeSnapshotFileName,
	validateProjectSnapshot,
	verifySnapshotChecksum
} from './snapshot-utils';

export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export interface SnapshotServiceRuntime {
	getProject(id: string): Promise<Project | undefined>;
	createProject(project: Project): Promise<Project>;
	deleteProject(id: string): Promise<void>;
	getProjectMediaIds(projectId: string): Promise<string[]>;
	getMedia(id: string): Promise<MediaMetadata | undefined>;
	getAllMedia(): Promise<MediaMetadata[]>;
	associateMedia(projectId: string, mediaId: string): Promise<void>;
}

export interface SnapshotExportOptions {
	includeMediaReferences?: boolean;
	stripViewState?: boolean;
	includeChecksum?: boolean;
	editorVersion?: string;
}

export interface SnapshotImportOptions {
	name?: string;
	matchMediaByHash?: boolean;
	matchMediaByName?: boolean;
	mediaIdMap?: ReadonlyMap<string, string>;
}

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

function serializeProject(project: Project, stripViewState: boolean): Project {
	const { rootFolderHandle: _rootFolderHandle, ...serializable } = project;
	const copy = structuredClone(serializable);
	if (!stripViewState || !copy.timeline) return copy;
	delete copy.timeline.currentFrame;
	delete copy.timeline.zoomLevel;
	delete copy.timeline.scrollPosition;
	return copy;
}

function sameNamedFile(reference: SnapshotMediaReference, media: MediaMetadata): boolean {
	return (
		media.fileName === reference.fileName &&
		media.fileSize === reference.fileSize &&
		media.mimeType === reference.mimeType &&
		media.duration === reference.duration &&
		media.width === reference.width &&
		media.height === reference.height &&
		media.fps === reference.fps
	);
}

function matchMedia(
	reference: SnapshotMediaReference,
	available: MediaMetadata[],
	options: SnapshotImportOptions
): MediaMetadata | undefined {
	const exact = available.find((media) => media.id === reference.id);
	if (
		exact &&
		(!reference.contentHash || !exact.contentHash || exact.contentHash === reference.contentHash)
	) {
		return exact;
	}
	if (options.matchMediaByHash !== false && reference.contentHash) {
		const hashed = available.find((media) => media.contentHash === reference.contentHash);
		return hashed;
	}
	if (options.matchMediaByName === false) return undefined;
	const metadataMatches = available.filter((media) => sameNamedFile(reference, media));
	return metadataMatches.length === 1 ? metadataMatches[0] : undefined;
}

export function createSnapshotService(runtime: SnapshotServiceRuntime) {
	async function exportProjectSnapshot(
		projectId: string,
		options: SnapshotExportOptions = {}
	): Promise<ProjectSnapshot> {
		const project = await runtime.getProject(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const mediaReferences: SnapshotMediaReference[] = [];
		if (options.includeMediaReferences !== false) {
			for (const mediaId of await runtime.getProjectMediaIds(projectId)) {
				const media = await runtime.getMedia(mediaId);
				if (media) mediaReferences.push(mediaReference(media));
			}
		}
		const snapshot: ProjectSnapshot = {
			version: PROJECT_SNAPSHOT_VERSION,
			exportedAt: new Date().toISOString(),
			editorVersion: options.editorVersion ?? 'OpenPost',
			project: serializeProject(project, options.stripViewState !== false),
			mediaReferences
		};
		if (options.includeChecksum !== false)
			snapshot.checksum = await computeSnapshotChecksum(snapshot);
		return snapshot;
	}

	async function importProjectSnapshot(
		snapshot: ProjectSnapshot,
		options: SnapshotImportOptions = {}
	): Promise<SnapshotImportResult> {
		const validation = validateProjectSnapshot(snapshot);
		if (!validation.snapshot) throw new Error(validation.errors.join('\n'));
		const validated = validation.snapshot;
		const warnings: string[] = [];
		if (!(await verifySnapshotChecksum(validated))) {
			warnings.push('The snapshot checksum does not match. Review the imported project.');
		}
		const migrated = migrateProjectDocument(validated.project);
		if (migrated.warnings.some((warning) => warning.code === 'FUTURE_SCHEMA')) {
			throw new Error(
				`This project uses schema ${migrated.fromVersion}. Update OpenPost before importing it.`
			);
		}
		warnings.push(...migrated.warnings.map((warning) => warning.message));
		const available = await runtime.getAllMedia();
		const mediaIdMap = new Map(options.mediaIdMap);
		const unmatchedMedia: SnapshotMediaReference[] = [];
		for (const reference of validated.mediaReferences) {
			if (mediaIdMap.has(reference.id)) continue;
			const media = matchMedia(reference, available, options);
			if (media) mediaIdMap.set(reference.id, media.id);
			else unmatchedMedia.push(reference);
		}
		const imported = cloneProjectDocument(migrated.project, {
			name: options.name?.trim() || `${migrated.project.name} imported`,
			mediaIdMap
		});
		let created = false;
		try {
			await runtime.createProject(imported);
			created = true;
			for (const mediaId of new Set(mediaIdMap.values())) {
				await runtime.associateMedia(imported.id, mediaId);
			}
			return {
				project: imported,
				matchedMedia: mediaIdMap.size,
				unmatchedMedia,
				warnings
			};
		} catch (error) {
			if (created) {
				try {
					await runtime.deleteProject(imported.id);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Project import failed and the partial project could not be removed.'
					);
				}
			}
			throw error;
		}
	}

	async function importProjectSnapshotJson(
		json: string,
		options: SnapshotImportOptions = {}
	): Promise<SnapshotImportResult> {
		if (new Blob([json]).size > MAX_SNAPSHOT_BYTES) {
			throw new Error('Project snapshot is larger than 32 MB.');
		}
		let parsed: JsonValue;
		try {
			// SAFETY: JSON.parse can only produce JSON primitives, arrays, and objects.
			parsed = JSON.parse(json) as JsonValue;
		} catch (error) {
			throw new Error('Project snapshot is not valid JSON.', { cause: error });
		}
		const validation = validateProjectSnapshot(parsed);
		if (!validation.snapshot) throw new Error(validation.errors.join('\n'));
		return importProjectSnapshot(validation.snapshot, options);
	}

	return { exportProjectSnapshot, importProjectSnapshot, importProjectSnapshotJson };
}

const productionRuntime: SnapshotServiceRuntime = {
	getProject,
	createProject,
	deleteProject,
	getProjectMediaIds,
	getMedia,
	getAllMedia,
	associateMedia: associateMediaWithProject
};

export const { exportProjectSnapshot, importProjectSnapshot, importProjectSnapshotJson } =
	createSnapshotService(productionRuntime);

export async function importProjectSnapshotFile(
	file: File,
	options: SnapshotImportOptions = {}
): Promise<SnapshotImportResult> {
	if (file.size > MAX_SNAPSHOT_BYTES) throw new Error('Project snapshot is larger than 32 MB.');
	return importProjectSnapshotJson(await file.text(), options);
}

export async function downloadProjectSnapshot(projectId: string): Promise<void> {
	const snapshot = await exportProjectSnapshot(projectId);
	const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = sanitizeSnapshotFileName(snapshot.project.name);
	link.style.display = 'none';
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}
}
