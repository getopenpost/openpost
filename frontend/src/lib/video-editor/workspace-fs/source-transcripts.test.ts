// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import * as fs from './fs-primitives';
import * as root from './root';
import {
	deleteSourceTranscript,
	getSourceTranscript,
	saveSourceTranscript,
	sourceTranscriptMatchesMedia,
	sourceTranscriptMatchesSelection,
	type SourceTranscript
} from './source-transcripts';

// SAFETY: the persistence matcher reads only the source identity fields supplied by this fixture.
const media = {
	id: 'media-1',
	fileSize: 123,
	fileLastModified: 456,
	contentHash: 'sha256'
} as MediaMetadata;

let stored: SourceTranscript | null = null;

beforeEach(() => {
	stored = null;
	vi.restoreAllMocks();
	// SAFETY: persistence tests only require an opaque workspace root identity.
	vi.spyOn(root, 'requireWorkspaceRoot').mockReturnValue({
		name: 'test'
	} as FileSystemDirectoryHandle);
	vi.spyOn(fs, 'readJson').mockImplementation(async () => stored);
	vi.spyOn(fs, 'writeJsonAtomic').mockImplementation(async (_root, _path, value) => {
		// SAFETY: saveSourceTranscript passes the complete validated document to this storage boundary.
		stored = value as SourceTranscript;
		return JSON.stringify(value).length;
	});
	vi.spyOn(fs, 'removeEntry').mockImplementation(async () => {
		stored = null;
	});
});

describe('source transcript persistence', () => {
	it('round-trips a versioned transcript and preserves its creation time on refresh', async () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200);
		const first = await saveSourceTranscript({
			media,
			selection: { model: 'whisper-base', language: 'en', quantization: 'hybrid' },
			resolvedModel: 'whisper-base',
			words: [{ text: 'First', startSeconds: 0, endSeconds: 1 }]
		});
		const refreshed = await saveSourceTranscript({
			media,
			selection: { model: 'whisper-base', language: 'en', quantization: 'hybrid' },
			resolvedModel: 'whisper-small',
			words: [{ text: 'Better', startSeconds: 0, endSeconds: 1 }]
		});

		expect(await getSourceTranscript(media.id)).toEqual(refreshed);
		expect(first.createdAt).toBe(100);
		expect(refreshed).toMatchObject({
			createdAt: 100,
			updatedAt: 200,
			resolvedModel: 'whisper-small',
			words: [{ text: 'Better', startSeconds: 0, endSeconds: 1 }]
		});
	});

	it('matches source identity and the exact requested model settings', async () => {
		const transcript = await saveSourceTranscript({
			media,
			selection: { model: 'whisper-base', language: 'en', quantization: 'hybrid' },
			resolvedModel: 'whisper-base',
			words: [{ text: 'Hello', startSeconds: 0, endSeconds: 1 }]
		});

		expect(sourceTranscriptMatchesMedia(transcript, media)).toBe(true);
		expect(sourceTranscriptMatchesMedia(transcript, { ...media, contentHash: 'other' })).toBe(
			false
		);
		expect(
			sourceTranscriptMatchesSelection(transcript, {
				model: 'whisper-base',
				language: 'en',
				quantization: 'hybrid'
			})
		).toBe(true);
		expect(
			sourceTranscriptMatchesSelection(transcript, {
				model: 'whisper-small',
				language: 'en',
				quantization: 'hybrid'
			})
		).toBe(false);
	});

	it('deletes only the stored transcript document', async () => {
		await saveSourceTranscript({
			media,
			selection: { model: 'whisper-base', quantization: 'hybrid' },
			resolvedModel: 'whisper-base',
			words: [{ text: 'Hello', startSeconds: 0, endSeconds: 1 }]
		});
		await deleteSourceTranscript(media.id);
		expect(await getSourceTranscript(media.id)).toBeNull();
		expect(fs.removeEntry).toHaveBeenCalledWith(expect.anything(), [
			'media',
			media.id,
			'cache',
			'ai',
			'transcript.json'
		]);
	});

	it('replaces malformed cached JSON without hiding other storage failures', async () => {
		vi.spyOn(fs, 'readJson').mockRejectedValueOnce(
			new fs.WorkspaceFileCorruptError('media/media-1/cache/ai/transcript.json', new SyntaxError())
		);
		await expect(getSourceTranscript(media.id)).resolves.toBeNull();

		vi.spyOn(fs, 'readJson').mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
		await expect(getSourceTranscript(media.id)).rejects.toMatchObject({ name: 'NotAllowedError' });
	});
});
