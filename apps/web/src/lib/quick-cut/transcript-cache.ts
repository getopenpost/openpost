import { z } from 'zod';
import {
	readJson,
	writeJsonAtomic,
	WorkspaceFileCorruptError
} from '$lib/video-editor/workspace-fs/fs-primitives';
import { aiOutputPath } from '$lib/video-editor/workspace-fs/paths';
import {
	assertSourceTranscriptStorageCurrent,
	sourceTranscriptRoot,
	type SourceTranscriptStorage
} from '$lib/video-editor/workspace-fs/source-transcripts';
import { quickCutTranscriptSchema } from './project';
import type { QuickCutSourceMetadata } from './types';

const cachedTranscriptSchema = z.object({
	schemaVersion: z.literal(1),
	fingerprint: z.string(),
	transcript: quickCutTranscriptSchema
});

function sourceFingerprint(source: QuickCutSourceMetadata): string {
	return JSON.stringify([
		source.id,
		source.size,
		source.lastModified ?? null,
		source.contentFingerprint ?? null,
		source.duration
	]);
}

export async function getQuickCutSourceTranscript(
	source: QuickCutSourceMetadata,
	storage: SourceTranscriptStorage
): Promise<NonNullable<QuickCutSourceMetadata['transcript']> | null> {
	const fingerprint = sourceFingerprint(source);
	const path = aiOutputPath(source.id, 'quick-cut-transcript');
	try {
		const raw = await readJson<unknown>(await sourceTranscriptRoot(storage), path);
		assertSourceTranscriptStorageCurrent(storage);
		const cached = cachedTranscriptSchema.safeParse(raw);
		if (!cached.success || cached.data.fingerprint !== fingerprint) return null;
		return cached.data.transcript;
	} catch (error) {
		if (error instanceof WorkspaceFileCorruptError) return null;
		throw error;
	}
}

export async function saveQuickCutSourceTranscript(
	source: QuickCutSourceMetadata,
	transcript: NonNullable<QuickCutSourceMetadata['transcript']>,
	storage: SourceTranscriptStorage,
	signal?: AbortSignal
): Promise<void> {
	const cached = cachedTranscriptSchema.parse({
		schemaVersion: 1,
		fingerprint: sourceFingerprint(source),
		transcript
	});
	const path = aiOutputPath(source.id, 'quick-cut-transcript');
	const root = await sourceTranscriptRoot(storage, signal);
	assertSourceTranscriptStorageCurrent(storage, signal);
	await writeJsonAtomic(root, path, cached);
	assertSourceTranscriptStorageCurrent(storage, signal);
}
