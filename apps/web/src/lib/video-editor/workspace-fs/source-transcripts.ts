import type { MediaMetadata } from '../media/types';
import type { TranscriptWord } from '../transcript/cues';
import type {
	TranscriptionModel,
	TranscriptionQuantization,
	TranscriptionSelection
} from '../transcript/engine/types';
import { readJson, removeEntry, WorkspaceFileCorruptError, writeJsonAtomic } from './fs-primitives';
import { sourceTranscriptPath } from './paths';
import { getWorkspaceRoot } from './root';
import {
	captureQueryMutationSession,
	queryMutationSessionIsCurrent,
	type QueryMutationSession
} from '$lib/query/authorization-boundary';

export type SourceTranscriptStorage =
	| { kind: 'local'; root: FileSystemDirectoryHandle | null }
	| { kind: 'cloud'; workspaceId: string; actorId: string; session: QueryMutationSession };

export function captureSourceTranscriptStorage(workspaceId = ''): SourceTranscriptStorage {
	if (!workspaceId) return { kind: 'local', root: getWorkspaceRoot() };
	const session = captureQueryMutationSession();
	const actorId = session.authorizationIdentity?.userID;
	if (!actorId) throw new Error('Cloud transcript storage requires a signed-in account.');
	return { kind: 'cloud', workspaceId, actorId, session };
}

export async function sourceTranscriptRoot(
	storage: SourceTranscriptStorage,
	signal?: AbortSignal
): Promise<FileSystemDirectoryHandle> {
	assertSourceTranscriptStorageCurrent(storage, signal);
	if (storage.kind === 'local') {
		if (!storage.root) throw new Error('Local transcript storage requires a workspace folder.');
		return storage.root;
	}
	const browserRoot = await navigator.storage.getDirectory();
	const transcripts = await browserRoot.getDirectoryHandle('openpost-source-transcripts', {
		create: true
	});
	const actor = await transcripts.getDirectoryHandle(storage.actorId, { create: true });
	const workspace = await actor.getDirectoryHandle(storage.workspaceId, { create: true });
	assertSourceTranscriptStorageCurrent(storage, signal);
	return workspace;
}

export function assertSourceTranscriptStorageCurrent(
	storage: SourceTranscriptStorage,
	signal?: AbortSignal
): void {
	signal?.throwIfAborted();
	if (storage.kind === 'cloud' && !queryMutationSessionIsCurrent(storage.session)) {
		throw new DOMException('Transcription session changed', 'AbortError');
	}
}

export interface SourceTranscript {
	schemaVersion: 1;
	mediaId: string;
	contentHash?: string;
	sourceFileSize: number;
	sourceLastModified?: number;
	model: TranscriptionModel;
	resolvedModel: TranscriptionModel;
	language?: string;
	quantization: TranscriptionQuantization;
	words: TranscriptWord[];
	createdAt: number;
	updatedAt: number;
}

export interface SaveSourceTranscriptInput {
	media: MediaMetadata;
	selection: TranscriptionSelection;
	resolvedModel: TranscriptionModel;
	words: TranscriptWord[];
	createdAt?: number;
	storage?: SourceTranscriptStorage;
	signal?: AbortSignal;
}

export function sourceTranscriptMatchesMedia(
	transcript: SourceTranscript,
	media: MediaMetadata
): boolean {
	if (transcript.mediaId !== media.id || transcript.sourceFileSize !== media.fileSize) return false;
	if (transcript.contentHash && media.contentHash)
		return transcript.contentHash === media.contentHash;
	return (
		transcript.sourceLastModified === undefined ||
		media.fileLastModified === undefined ||
		transcript.sourceLastModified === media.fileLastModified
	);
}

export function sourceTranscriptMatchesSelection(
	transcript: SourceTranscript,
	selection: TranscriptionSelection
): boolean {
	return (
		transcript.model === selection.model &&
		transcript.language === selection.language &&
		transcript.quantization === selection.quantization
	);
}

export async function getSourceTranscript(
	mediaId: string,
	storage = captureSourceTranscriptStorage()
): Promise<SourceTranscript | null> {
	try {
		const transcript = await readJson<SourceTranscript>(
			await sourceTranscriptRoot(storage),
			sourceTranscriptPath(mediaId)
		);
		assertSourceTranscriptStorageCurrent(storage);
		return transcript?.schemaVersion === 1 && transcript.mediaId === mediaId ? transcript : null;
	} catch (error) {
		if (error instanceof WorkspaceFileCorruptError) return null;
		throw error;
	}
}

export async function saveSourceTranscript(
	input: SaveSourceTranscriptInput
): Promise<SourceTranscript> {
	const now = Date.now();
	const storage = input.storage ?? captureSourceTranscriptStorage();
	const root = await sourceTranscriptRoot(storage, input.signal);
	const previous = await getSourceTranscript(input.media.id, storage);
	const transcript: SourceTranscript = {
		schemaVersion: 1,
		mediaId: input.media.id,
		contentHash: input.media.contentHash,
		sourceFileSize: input.media.fileSize,
		sourceLastModified: input.media.fileLastModified,
		model: input.selection.model,
		resolvedModel: input.resolvedModel,
		language: input.selection.language,
		quantization: input.selection.quantization,
		words: input.words.map((word) => ({ ...word })),
		createdAt: input.createdAt ?? previous?.createdAt ?? now,
		updatedAt: now
	};
	assertSourceTranscriptStorageCurrent(storage, input.signal);
	await writeJsonAtomic(root, sourceTranscriptPath(input.media.id), transcript);
	assertSourceTranscriptStorageCurrent(storage, input.signal);
	return transcript;
}

export async function deleteSourceTranscript(
	mediaId: string,
	storage = captureSourceTranscriptStorage()
): Promise<void> {
	const root = await sourceTranscriptRoot(storage);
	assertSourceTranscriptStorageCurrent(storage);
	await removeEntry(root, sourceTranscriptPath(mediaId));
}
