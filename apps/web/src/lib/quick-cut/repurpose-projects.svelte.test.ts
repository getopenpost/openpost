import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRepurposeProjects } from './repurpose-projects';
import { loadProjectSessionFromWorkspace, listProjectsFromWorkspace } from './project';
import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import type { QuickCutSource } from './types';
import { CloudVideoProjectRepository } from '$lib/video-editor/cloud/project-repository';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';

const boundary = vi.hoisted<{ afterWrite: (() => void) | null; cacheFails: boolean }>(() => ({
	afterWrite: null,
	cacheFails: false
}));
// Preserve real OPFS writes while scheduling cancellation at the external commit boundary.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/video-editor/workspace-fs/fs-primitives', async (original) => {
	const actual = await original<typeof import('$lib/video-editor/workspace-fs/fs-primitives')>();
	return {
		...actual,
		writeJsonAtomic: async (...args: Parameters<typeof actual.writeJsonAtomic>) => {
			await actual.writeJsonAtomic(...args);
			boundary.afterWrite?.();
		}
	};
});
// The quota regression starts after an admitted upload; real uploads are covered by the route test.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/media-upload-client', () => ({
	uploadMediaFile: vi.fn().mockResolvedValue(undefined)
}));
// Real storage remains in use; only quota exhaustion is injected at its adapter boundary.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('./transcript-cache', async (original) => {
	const actual = await original<typeof import('./transcript-cache')>();
	return {
		...actual,
		saveQuickCutSourceTranscript: async (
			...args: Parameters<typeof actual.saveQuickCutSourceTranscript>
		) => {
			if (boundary.cacheFails) throw new DOMException('Storage is full', 'QuotaExceededError');
			return actual.saveQuickCutSourceTranscript(...args);
		}
	};
});
let root: FileSystemDirectoryHandle;
beforeEach(async () => {
	root = await (
		await navigator.storage.getDirectory()
	).getDirectoryHandle(crypto.randomUUID(), { create: true });
	setWorkspaceRoot(root);
	boundary.afterWrite = null;
	boundary.cacheFails = false;
});
afterEach(async () => {
	setWorkspaceRoot(null);
	await (await navigator.storage.getDirectory()).removeEntry(root.name, { recursive: true });
});
function source(): QuickCutSource {
	const file = new File(['full original media contents'], 'original.mp4', {
		type: 'video/mp4',
		lastModified: 10
	});
	return {
		id: 'original-source',
		name: file.name,
		size: file.size,
		file,
		mimeType: file.type,
		lastModified: file.lastModified,
		duration: 20,
		width: 640,
		height: 360,
		videoCodec: 'avc',
		audioCodec: 'aac',
		sampleRate: 48000,
		channels: 1,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [],
		keyframeState: 'unknown',
		videoStreams: [],
		audioStreams: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 1 }],
		selectedAudioTrackIndices: [1],
		transcript: { audioTrackIndex: 1, words: [{ text: 'Complete source', start: 0, end: 20 }] }
	};
}

test('local clip projects reopen with independent ranges and the full original source', async () => {
	const input = source();
	const results: string[] = [];
	await createRepurposeProjects({
		source: input,
		choices: [
			{ id: 'one', title: 'First clip', start: 2, end: 5 },
			{ id: 'two', title: 'Second clip', start: 9, end: 12 }
		],
		storage: 'local',
		workspaceId: '',
		signal: new AbortController().signal,
		isCurrent: () => true,
		onProgress: () => {},
		onWarning: () => {},
		onCreated: (result) => results.push(result.projectId)
	});
	expect(results).toHaveLength(2);
	const first = await loadProjectSessionFromWorkspace(results[0]!);
	const second = await loadProjectSessionFromWorkspace(results[1]!);
	expect(first?.sources[0]?.id).not.toBe(second?.sources[0]?.id);
	expect(first?.project.segments).toMatchObject([{ start: 2, end: 5, cutMode: 'exact' }]);
	expect(second?.project.segments).toMatchObject([{ start: 9, end: 12, cutMode: 'exact' }]);
	expect(await first?.sources[0]?.file?.text()).toBe('full original media contents');
	expect(await second?.sources[0]?.file?.text()).toBe('full original media contents');
	expect(input.id).toBe('original-source');
});

test('cancelling after a local write leaves no unreported project', async () => {
	const request = new AbortController();
	const onCreated = vi.fn();
	boundary.afterWrite = () => request.abort();
	await expect(
		createRepurposeProjects({
			source: source(),
			choices: [{ id: 'one', title: 'Cancelled clip', start: 2, end: 5 }],
			storage: 'local',
			workspaceId: '',
			signal: request.signal,
			isCurrent: () => true,
			onProgress: () => {},
			onWarning: () => {},
			onCreated
		})
	).rejects.toMatchObject({ name: 'AbortError' });
	expect(onCreated).not.toHaveBeenCalled();
	expect((await listProjectsFromWorkspace()).projects).toEqual([]);
});

test('a full browser cache does not discard a completed cloud clip', async () => {
	const release = registerQueryAuthorizationBoundary({
		captureIdentity: () => ({ userID: 'actor', epoch: 1 }),
		isIdentityCurrent: () => true,
		settleUnauthorized: () => {}
	});
	const create = vi
		.spyOn(CloudVideoProjectRepository.prototype, 'createWithId')
		.mockResolvedValue(undefined!);
	const reserve = vi
		.spyOn(CloudVideoProjectRepository.prototype, 'reserveAsset')
		.mockResolvedValue('asset');
	const trash = vi.spyOn(CloudVideoProjectRepository.prototype, 'trash').mockResolvedValue();
	boundary.cacheFails = true;
	const created = vi.fn();
	const warning = vi.fn();
	try {
		await createRepurposeProjects({
			source: source(),
			choices: [{ id: 'one', title: 'Saved clip', start: 2, end: 5 }],
			storage: 'cloud',
			workspaceId: 'workspace',
			signal: new AbortController().signal,
			isCurrent: () => true,
			onProgress: () => {},
			onWarning: warning,
			onCreated: created
		});
		expect(created).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Saved clip', storage: 'cloud' })
		);
		expect(warning).toHaveBeenCalledWith(
			'Your project is available, but its transcript could not be kept on this device. You can still edit and export it.'
		);
		expect(trash).not.toHaveBeenCalled();
	} finally {
		create.mockRestore();
		reserve.mockRestore();
		trash.mockRestore();
		release();
	}
});
