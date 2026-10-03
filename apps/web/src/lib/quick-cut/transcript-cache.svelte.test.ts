import { expect, it } from 'vitest';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';
import { getWorkspaceRoot, setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { captureSourceTranscriptStorage } from '$lib/video-editor/workspace-fs/source-transcripts';
import { readJson } from '$lib/video-editor/workspace-fs/fs-primitives';
import { aiOutputPath } from '$lib/video-editor/workspace-fs/paths';
import { getQuickCutSourceTranscript, saveQuickCutSourceTranscript } from './transcript-cache';
import type { QuickCutSourceMetadata } from './types';

function source(): QuickCutSourceMetadata {
	return {
		id: crypto.randomUUID(),
		name: 'Recording.wav',
		size: 120,
		mimeType: 'audio/wav',
		duration: 3,
		width: 0,
		height: 0,
		videoCodec: null,
		audioCodec: 'pcm',
		sampleRate: 48000,
		channels: 1,
		rotation: 0,
		fps: null,
		keyframeTimestamps: [],
		keyframeState: 'audio-only',
		videoStreams: [],
		audioStreams: [],
		lastModified: 100,
		contentFingerprint: 'original-source'
	};
}

const transcript = {
	audioTrackIndex: 1,
	words: [{ text: 'An intact thought.', start: 0.2, end: 2.5 }]
};

it('reopens source words only for their source, account and Workspace and copies them independently', async () => {
	const actors = [crypto.randomUUID(), crypto.randomUUID()];
	let actor = actors[0]!;
	const workspace = crypto.randomUUID();
	const dispose = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: actor, epoch: 1 }),
		isIdentityCurrent: (identity) => identity?.userID === actor,
		settleUnauthorized: () => {}
	});
	const original = source();
	const storage = captureSourceTranscriptStorage(workspace);
	try {
		await saveQuickCutSourceTranscript(original, transcript, storage);
		expect(await getQuickCutSourceTranscript(original, storage)).toEqual(transcript);
		for (const changed of [
			{ ...original, size: 121 },
			{ ...original, lastModified: 101 },
			{ ...original, contentFingerprint: 'replaced-source' },
			{ ...original, duration: 4 }
		])
			expect(await getQuickCutSourceTranscript(changed, storage)).toBeNull();
		const copy = { ...original, id: crypto.randomUUID() };
		await saveQuickCutSourceTranscript(copy, transcript, storage);
		await saveQuickCutSourceTranscript(
			copy,
			{ ...transcript, words: [{ text: 'Corrected copy.', start: 0.2, end: 2.5 }] },
			storage
		);
		expect((await getQuickCutSourceTranscript(copy, storage))?.words[0]?.text).toBe(
			'Corrected copy.'
		);
		expect(await getQuickCutSourceTranscript(original, storage)).toEqual(transcript);
		expect(
			await getQuickCutSourceTranscript(
				original,
				captureSourceTranscriptStorage(crypto.randomUUID())
			)
		).toBeNull();
		actor = actors[1]!;
		expect(
			await getQuickCutSourceTranscript(original, captureSourceTranscriptStorage(workspace))
		).toBeNull();
		await expect(saveQuickCutSourceTranscript(original, transcript, storage)).rejects.toMatchObject(
			{ name: 'AbortError' }
		);
	} finally {
		dispose();
		const root = await navigator.storage.getDirectory();
		const cache = await root.getDirectoryHandle('openpost-source-transcripts');
		for (const id of actors) await cache.removeEntry(id, { recursive: true });
	}
});

it('writes local words to the captured folder even if the active folder changes', async () => {
	const previous = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const name = `quick-cut-transcript-${crypto.randomUUID()}`;
	const folder = await root.getDirectoryHandle(name, { create: true });
	const original = source();
	try {
		setWorkspaceRoot(folder);
		const storage = captureSourceTranscriptStorage();
		setWorkspaceRoot(null);
		await saveQuickCutSourceTranscript(original, transcript, storage);
		expect(await getQuickCutSourceTranscript(original, storage)).toEqual(transcript);
		expect(await readJson(folder, aiOutputPath(original.id, 'quick-cut-transcript'))).toMatchObject(
			{ transcript }
		);
	} finally {
		setWorkspaceRoot(previous);
		await root.removeEntry(name, { recursive: true });
	}
});
