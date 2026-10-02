import { afterEach, expect, it, vi } from 'vitest';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';
import { editorSession } from '../editor.svelte';
import { CloudVideoProjectRepository } from '../cloud/project-repository';
import { createBlankProject } from '../project/defaults';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata } from '../media/types';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import {
	getSourceTranscript,
	saveSourceTranscript,
	deleteSourceTranscript
} from '../workspace-fs/source-transcripts';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { captureSourceTranscriptStorage } from '../workspace-fs/source-transcripts';
import { TranscriptionService, transcriptionService } from './transcription-service.svelte';
import { render } from 'vitest-browser-svelte';
import MediaPoolList from '../components/media-pool-list.svelte';
import { TranscriptionJob } from './engine/transcriber';

const media: MediaMetadata = {
	id: 'speech',
	storageType: 'cloud',
	fileName: 'speech.wav',
	fileSize: 4,
	mimeType: 'audio/wav',
	duration: 2,
	width: 0,
	height: 0,
	fps: 30,
	codec: 'pcm',
	bitrate: 0,
	tags: [],
	hasAudio: true
};
const words = [{ text: 'Hello', startSeconds: 0.1, endSeconds: 0.6 }];
const selection = { model: 'whisper-tiny', quantization: 'q8' } as const;

afterEach(() => {
	editorSession.stopAutosaveTimers();
	editorSession.project = null;
	mediaPool.clear();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	vi.restoreAllMocks();
});

it('generates, reopens and deletes a Cloud source transcript without a local folder', async () => {
	const previous = getWorkspaceRoot();
	setWorkspaceRoot(null);
	const actor = crypto.randomUUID();
	const workspace = crypto.randomUUID();
	const dispose = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: actor, epoch: 1 }),
		isIdentityCurrent: (identity) => identity?.userID === actor,
		settleUnauthorized: () => {}
	});
	const project = createBlankProject('Cloud speech');
	vi.spyOn(CloudVideoProjectRepository.prototype, 'get').mockResolvedValue({
		id: project.id,
		workspaceId: workspace,
		name: project.name,
		headRevision: 1,
		document: project,
		syncStatus: 'synced',
		attentionReason: '',
		trashedAt: '',
		updatedAt: ''
	});
	vi.spyOn(CloudVideoProjectRepository.prototype, 'listMedia').mockResolvedValue([]);
	const transcribe = vi.fn(async () => words);
	const dependencies = {
		resolveSource: async () => new Blob(['wave'], { type: 'audio/wav' }),
		transcribe,
		getSourceTranscript,
		saveSourceTranscript,
		deleteSourceTranscript
	};
	const service = new TranscriptionService(dependencies);
	try {
		await editorSession.load(project.id, workspace);
		expect(editorSession.loadError).toBe('');
		mediaPool.upsert(media, 'ready');
		const result = await service.enqueueMedia(media.id, selection);
		expect(result.words).toEqual(words);
		service.reset();
		const reopened = new TranscriptionService(dependencies);
		expect((await reopened.hydrateSourceTranscript(media.id))?.words).toEqual(words);
		timelineStore._setItems([
			{
				id: 'clip',
				type: 'audio',
				mediaId: media.id,
				label: 'Speech',
				trackId: 'track-audio',
				from: 0,
				durationInFrames: 60,
				sourceStart: 0,
				sourceEnd: 60,
				sourceFps: 30
			}
		]);
		const captions = await reopened.enqueue('clip', selection);
		expect(timelineStore.itemById.get(captions.subtitleItemId)?.cues?.[0]?.text).toBe('Hello');
		expect(commandHistory.canUndo).toBe(true);
		expect(transcribe).toHaveBeenCalledTimes(1);
		await reopened.deleteMediaTranscript(media.id);
		reopened.reset();
		expect(await reopened.hydrateSourceTranscript(media.id)).toBeNull();
	} finally {
		service.reset();
		dispose();
		const root = await navigator.storage.getDirectory();
		const transcripts = await root.getDirectoryHandle('openpost-source-transcripts');
		await transcripts.removeEntry(actor, { recursive: true });
		setWorkspaceRoot(previous);
	}
});

it('isolates persisted transcripts by account and Workspace and keeps local folder paths', async () => {
	const previous = getWorkspaceRoot();
	let actor = crypto.randomUUID();
	let epoch = 1;
	const originalActor = actor;
	const workspace = crypto.randomUUID();
	const dispose = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: actor, epoch }),
		isIdentityCurrent: (identity) => identity?.userID === actor && identity.epoch === epoch,
		settleUnauthorized: () => {}
	});
	const root = await navigator.storage.getDirectory();
	const folderName = `transcript-local-${crypto.randomUUID()}`;
	const folder = await root.getDirectoryHandle(folderName, { create: true });
	const storage = captureSourceTranscriptStorage(workspace);
	let activeWorkspace = workspace;
	const service = new TranscriptionService({
		resolveSource: vi.fn(),
		transcribe: vi.fn(),
		getSourceTranscript,
		saveSourceTranscript,
		deleteSourceTranscript,
		getStorage: () => captureSourceTranscriptStorage(activeWorkspace)
	});
	mediaPool.upsert(media, 'ready');
	try {
		setWorkspaceRoot(folder);
		const input = { media, selection, resolvedModel: selection.model, words };
		await saveSourceTranscript({ ...input, storage });
		expect((await service.hydrateSourceTranscript(media.id))?.words).toEqual(words);
		activeWorkspace = crypto.randomUUID();
		expect(await service.hydrateSourceTranscript(media.id)).toBeNull();
		activeWorkspace = workspace;
		expect((await service.hydrateSourceTranscript(media.id))?.words).toEqual(words);
		expect(
			await getSourceTranscript(media.id, captureSourceTranscriptStorage(crypto.randomUUID()))
		).toBeNull();
		actor = crypto.randomUUID();
		epoch++;
		expect(await service.hydrateSourceTranscript(media.id)).toBeNull();
		expect(
			await getSourceTranscript(media.id, captureSourceTranscriptStorage(workspace))
		).toBeNull();
		await expect(saveSourceTranscript({ ...input, storage })).rejects.toMatchObject({
			name: 'AbortError'
		});
		await saveSourceTranscript(input);
		setWorkspaceRoot(null);
		expect((await getSourceTranscript(media.id, { kind: 'local', root: folder }))?.words).toEqual(
			words
		);
		await deleteSourceTranscript(media.id, { kind: 'local', root: folder });
		expect(await getSourceTranscript(media.id, { kind: 'local', root: folder })).toBeNull();
	} finally {
		const transcripts = await root.getDirectoryHandle('openpost-source-transcripts');
		await transcripts.removeEntry(originalActor, { recursive: true });
		await transcripts.removeEntry(actor, { recursive: true });
		await root.removeEntry(folderName, { recursive: true });
		dispose();
		setWorkspaceRoot(previous);
	}
});

it.each(['cancel', 'account change'] as const)(
	'does not persist a source result after %s',
	async (reason) => {
		const previous = getWorkspaceRoot();
		setWorkspaceRoot(null);
		const actor = crypto.randomUUID();
		let epoch = 1;
		const dispose = registerQueryAuthorizationBoundary({
			captureIdentity: () => ({ userID: actor, epoch }),
			isIdentityCurrent: (identity) => identity?.userID === actor && identity.epoch === epoch,
			settleUnauthorized: () => {}
		});
		const storage = captureSourceTranscriptStorage(crypto.randomUUID());
		const engine = Promise.withResolvers<typeof words>();
		const transcribe = vi.fn(() => engine.promise);
		const service = new TranscriptionService({
			resolveSource: async () => new Blob(['wave']),
			transcribe,
			getSourceTranscript,
			saveSourceTranscript,
			deleteSourceTranscript,
			getStorage: () => storage
		});
		mediaPool.upsert(media, 'ready');
		const outcome = service.enqueueMedia(media.id, selection).catch((error: Error) => error);
		try {
			await expect.poll(() => transcribe.mock.calls.length).toBe(1);
			if (reason === 'cancel') service.cancelForMedia(media.id);
			else epoch++;
			engine.resolve(words);
			expect(await outcome).toMatchObject({ name: 'AbortError' });
			service.reset();
			const current =
				reason === 'cancel'
					? storage
					: captureSourceTranscriptStorage(storage.kind === 'cloud' ? storage.workspaceId : '');
			expect(await getSourceTranscript(media.id, current)).toBeNull();
			expect(service.sourceTranscriptStatus(media.id)).toBe('loading');
		} finally {
			engine.resolve(words);
			service.reset();
			const root = await navigator.storage.getDirectory();
			const transcripts = await root.getDirectoryHandle('openpost-source-transcripts');
			await transcripts.removeEntry(actor, { recursive: true });
			dispose();
			setWorkspaceRoot(previous);
		}
	}
);

it('cancels a session reset while persistence is awaiting browser storage', async () => {
	const previous = getWorkspaceRoot();
	setWorkspaceRoot(null);
	const actor = crypto.randomUUID();
	const dispose = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: actor, epoch: 1 }),
		isIdentityCurrent: (identity) => identity?.userID === actor,
		settleUnauthorized: () => {}
	});
	const storage = captureSourceTranscriptStorage(crypto.randomUUID());
	const root = await navigator.storage.getDirectory();
	const opened = Promise.withResolvers<FileSystemDirectoryHandle>();
	const getDirectory = vi
		.spyOn(navigator.storage, 'getDirectory')
		.mockImplementationOnce(() => opened.promise);
	const service = new TranscriptionService({
		resolveSource: async () => new Blob(['wave']),
		transcribe: async () => words,
		getSourceTranscript,
		saveSourceTranscript,
		deleteSourceTranscript,
		getStorage: () => storage
	});
	mediaPool.upsert(media, 'ready');
	const outcome = service.enqueueMedia(media.id, selection).catch((error: Error) => error);
	try {
		await expect.poll(() => getDirectory.mock.calls.length).toBe(1);
		service.reset();
		opened.resolve(root);
		expect(await outcome).toMatchObject({ name: 'AbortError' });
		expect(await getSourceTranscript(media.id, storage)).toBeNull();
		expect(service.sourceTranscriptStatus(media.id)).toBe('loading');
	} finally {
		opened.resolve(root);
		service.reset();
		getDirectory.mockRestore();
		const transcripts = await root.getDirectoryHandle('openpost-source-transcripts');
		await transcripts.removeEntry(actor, { recursive: true });
		dispose();
		setWorkspaceRoot(previous);
	}
});

it('runs Generate transcript from the Cloud Media menu and retains it after remount', async () => {
	const previous = getWorkspaceRoot();
	setWorkspaceRoot(null);
	const actor = crypto.randomUUID();
	const workspace = crypto.randomUUID();
	const dispose = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: actor, epoch: 1 }),
		isIdentityCurrent: (identity) => identity?.userID === actor,
		settleUnauthorized: () => {}
	});
	const project = createBlankProject('Cloud Media transcript');
	vi.spyOn(CloudVideoProjectRepository.prototype, 'get').mockResolvedValue({
		id: project.id,
		workspaceId: workspace,
		name: project.name,
		headRevision: 1,
		document: project,
		syncStatus: 'synced',
		attentionReason: '',
		trashedAt: '',
		updatedAt: ''
	});
	vi.spyOn(CloudVideoProjectRepository.prototype, 'listMedia').mockResolvedValue([]);
	const collect = vi
		.spyOn(TranscriptionJob.prototype, 'collect')
		.mockResolvedValue([
			{ text: 'Hello', start: 0.1, end: 0.6, words: [{ text: 'Hello', start: 0.1, end: 0.6 }] }
		]);
	const url = URL.createObjectURL(new Blob(['wave'], { type: 'audio/wav' }));
	let screen: ReturnType<typeof render> | undefined;
	try {
		await editorSession.load(project.id, workspace);
		mediaPool.upsert({ ...media, remoteUrl: url }, 'ready');
		screen = render(MediaPoolList, { projectId: project.id });
		await expect.poll(() => transcriptionService.sourceTranscriptStatus(media.id)).toBe('idle');
		await screen.getByRole('button', { name: 'More actions for speech.wav' }).click();
		await screen.getByRole('menuitem', { name: 'Generate transcript', exact: true }).click();
		await expect.poll(() => transcriptionService.sourceTranscriptStatus(media.id)).toBe('ready');
		expect(collect).toHaveBeenCalledTimes(1);
		await screen.unmount();
		screen.container.remove();
		screen = undefined;
		transcriptionService.reset();
		screen = render(MediaPoolList, { projectId: project.id });
		await expect.poll(() => transcriptionService.sourceTranscriptStatus(media.id)).toBe('ready');
		await screen.getByRole('button', { name: 'More actions for speech.wav' }).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Refresh transcript', exact: true }))
			.toBeVisible();
		await screen.getByRole('menuitem', { name: 'Delete transcript', exact: true }).click();
		await expect.poll(() => transcriptionService.sourceTranscriptStatus(media.id)).toBe('idle');
		transcriptionService.reset();
		expect(await transcriptionService.hydrateSourceTranscript(media.id)).toBeNull();
	} finally {
		await screen?.unmount();
		screen?.container.remove();
		transcriptionService.reset();
		URL.revokeObjectURL(url);
		const root = await navigator.storage.getDirectory();
		const transcripts = await root.getDirectoryHandle('openpost-source-transcripts');
		await transcripts.removeEntry(actor, { recursive: true });
		dispose();
		setWorkspaceRoot(previous);
	}
});
