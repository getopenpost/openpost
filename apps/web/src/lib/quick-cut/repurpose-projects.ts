import {
	captureQueryMutationSession,
	queryMutationSessionIsCurrent
} from '$lib/query/authorization-boundary';
import { captureSourceTranscriptStorage } from '$lib/video-editor/workspace-fs/source-transcripts';
import { saveQuickCutSourceTranscript } from './transcript-cache';
import { repurposeAudioTrack } from './repurpose-source';
import { portableVideoProjectDocument } from '@openpost/video-project';
import { m } from '$lib/paraglide/messages';
import { uploadMediaFile } from '$lib/media-upload-client';
import { CloudVideoProjectRepository } from '$lib/video-editor/cloud/project-repository';
import { hashBlob } from '$lib/video-editor/project-bundle/bundle-utils';
import { deleteHandle } from '$lib/video-editor/workspace-fs/handles-db';
import { writeJsonAtomic, removeEntry } from '$lib/video-editor/workspace-fs/fs-primitives';
import { getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { quickCutCloudDocument } from './cloud-project';
import { createNewProject, persistSourceHandles } from './project';
import { quickCutProjectPath } from './paths';
import { createSegment } from './model';
import type { QuickCutSource } from './types';

export interface RepurposeProjectChoice {
	id: string;
	title: string;
	start: number;
	end: number;
}
export interface RepurposeCreationProgress {
	completed: number;
	total: number;
	fraction?: number;
}

export interface RepurposeProjectResult {
	candidateId: string;
	projectId: string;
	name: string;
	storage: 'cloud' | 'local';
}

/** Keep the original media, with independent source identities and exact editable ranges. */
export async function createRepurposeProjects(input: {
	source: QuickCutSource;
	choices: RepurposeProjectChoice[];
	storage: 'cloud' | 'local';
	workspaceId: string;
	signal: AbortSignal;
	isCurrent: () => boolean;
	onProgress: (progress: RepurposeCreationProgress) => void;
	onCreated: (result: RepurposeProjectResult) => void;
	onWarning: (message: string) => void;
}) {
	const { source, signal } = input;
	const session = captureQueryMutationSession();
	const transcriptStorage = captureSourceTranscriptStorage(
		input.storage === 'cloud' ? input.workspaceId : ''
	);
	const root = getWorkspaceRoot();
	function guard() {
		signal.throwIfAborted();
		if (
			!queryMutationSessionIsCurrent(session) ||
			!input.isCurrent() ||
			(input.storage === 'local' && getWorkspaceRoot() !== root)
		) {
			throw new DOMException('The source or workspace changed.', 'AbortError');
		}
	}
	guard();
	input.onProgress({ completed: 0, total: input.choices.length });
	let file = source.file ?? (await source.handle?.getFile());
	if (!file) throw new Error(m.repurpose_source_missing());
	guard();
	let handle = source.handle;
	const sha256 = input.storage === 'cloud' ? await hashBlob(file) : '';
	guard();
	if (input.storage === 'local' && !handle) {
		if (!root) throw new Error(m.repurpose_folder_missing());
		let directory = root;
		for (const part of ['quick-cut', 'sources', crypto.randomUUID()]) {
			guard();
			directory = await directory.getDirectoryHandle(part, { create: true });
		}
		guard();
		handle = await directory.getFileHandle(file.name, { create: true });
		const writer = await handle.createWritable();
		try {
			guard();
			await writer.write(file);
			guard();
			await writer.close();
		} catch (error) {
			await writer.abort().catch(() => {});
			throw error;
		}
		file = await handle.getFile();
	}
	const repository =
		input.storage === 'cloud' ? new CloudVideoProjectRepository(input.workspaceId) : null;
	for (const [index, choice] of input.choices.entries()) {
		input.onProgress({ completed: index, total: input.choices.length });
		guard();
		const { file: _file, handle: _handle, ...metadata } = source;
		const copiedSource: QuickCutSource = {
			...portableVideoProjectDocument(metadata),
			selectedAudioTrackIndices: [repurposeAudioTrack(source)!],
			id: crypto.randomUUID(),
			lastModified: file.lastModified,
			file,
			handle
		};
		const { file: _copyFile, handle: _copyHandle, ...copiedMetadata } = copiedSource;
		const project = createNewProject([copiedMetadata], 'exact');
		project.name = choice.title.trim().slice(0, 100) || source.name;
		project.segments = [
			createSegment(choice.start, choice.end, {
				sourceId: copiedSource.id,
				cutMode: 'exact'
			})
		];
		if (repository) {
			let created = false;
			try {
				await repository.createWithId(project.id, project.name, quickCutCloudDocument(project));
				created = true;
				guard();
				const assetId = await repository.reserveAsset(project.id, {
					stableMediaId: copiedSource.id,
					fileName: file.name,
					mimeType: file.type || source.mimeType,
					size: file.size,
					sha256
				});
				guard();
				await uploadMediaFile({
					workspaceId: input.workspaceId,
					projectAssetId: assetId,
					file,
					clientSHA256: sha256,
					source: 'video_editor_source',
					assetKind: 'project_asset',
					retentionClass: 'temporary',
					prepareVideo: false,
					signal,
					onProgress: (progress) => {
						if (input.isCurrent() && !signal.aborted)
							input.onProgress({
								completed: index,
								total: input.choices.length,
								fraction: progress.indeterminate ? undefined : progress.fraction
							});
					}
				});
				guard();
			} catch (error) {
				if (created && queryMutationSessionIsCurrent(session))
					await repository.trash(project.id).catch(() => {});
				throw error;
			}
		} else {
			if (!root) throw new Error(m.repurpose_folder_missing());
			try {
				await persistSourceHandles([copiedSource]);
				guard();
				await writeJsonAtomic(root, quickCutProjectPath(project.id), project);
				guard();
			} catch (error) {
				await removeEntry(root, quickCutProjectPath(project.id)).catch(() => {});
				await deleteHandle('media', `quick-cut:${copiedSource.id}`).catch(() => {});
				throw error;
			}
		}
		guard();
		input.onCreated({
			candidateId: choice.id,
			projectId: project.id,
			name: project.name,
			storage: input.storage
		});
		if (repository && copiedSource.transcript) {
			try {
				await saveQuickCutSourceTranscript(
					copiedMetadata,
					copiedSource.transcript,
					transcriptStorage,
					signal
				);
			} catch (error) {
				guard();
				input.onWarning(m.repurpose_transcript_storage_failed());
			}
		}
	}
}
