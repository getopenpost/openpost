import type { MediaMetadata } from '../media/types';
import type { TranscriptWord } from '../transcript/cues';
import type {
	TranscriptionModel,
	TranscriptionQuantization,
	TranscriptionSelection
} from '../transcript/engine/types';
import { readJson, removeEntry, WorkspaceFileCorruptError, writeJsonAtomic } from './fs-primitives';
import { sourceTranscriptPath } from './paths';
import { requireWorkspaceRoot } from './root';

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

export async function getSourceTranscript(mediaId: string): Promise<SourceTranscript | null> {
	try {
		const transcript = await readJson<SourceTranscript>(
			requireWorkspaceRoot(),
			sourceTranscriptPath(mediaId)
		);
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
	const previous = await getSourceTranscript(input.media.id);
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
	await writeJsonAtomic(requireWorkspaceRoot(), sourceTranscriptPath(input.media.id), transcript);
	return transcript;
}

export async function deleteSourceTranscript(mediaId: string): Promise<void> {
	await removeEntry(requireWorkspaceRoot(), sourceTranscriptPath(mediaId));
}
