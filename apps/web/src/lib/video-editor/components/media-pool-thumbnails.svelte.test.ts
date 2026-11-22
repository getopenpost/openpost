import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanup, render } from 'vitest-browser-svelte';
import { readBlob } from '@openpost/editor-shared/workspace';
import { getWorkspaceRoot, setWorkspaceRoot } from '@openpost/editor-shared/workspace';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata } from '@openpost/editor-shared/media';
import MediaPoolList from './media-pool-list.svelte';
import ColorMiniTimeline from './color-mini-timeline.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';

// Hold filesystem reads while the real library publishes and invalidates thumbnails.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('@openpost/editor-shared/workspace', async (original) => ({
	...(await original<typeof import('@openpost/editor-shared/workspace')>()),
	readBlob: vi.fn()
}));

let priorRoot: FileSystemDirectoryHandle | null;
beforeEach(async () => {
	priorRoot = getWorkspaceRoot();
	setWorkspaceRoot(await navigator.storage.getDirectory());
	mediaPool.clear();
	sequenceStore.reset();
	commandHistory.clearHistory();
	vi.mocked(readBlob).mockReset();
});
afterEach(async () => {
	await cleanup();
	mediaPool.clear();
	sequenceStore.reset();
	commandHistory.clearHistory();
	setWorkspaceRoot(priorRoot);
	vi.restoreAllMocks();
});

function source(id: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.mp4`,
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: 1,
		width: 100,
		height: 100,
		fps: 30,
		codec: 'h264',
		bitrate: 100,
		tags: ['video']
	};
}
const thumbnail = new Blob(
	[
		'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
	],
	{ type: 'image/svg+xml' }
);

it('loads an imported thumbnail when its file is ready, without reading the unfinished import', async () => {
	const media = source('import');
	mediaPool.upsert(media, 'importing', 0.2);
	vi.mocked(readBlob).mockResolvedValue(thumbnail);
	const screen = await render(MediaPoolList, { projectId: 'thumbnail-import' });
	await tick();
	expect(readBlob).not.toHaveBeenCalled();
	mediaPool.upsert(media, 'ready');
	await expect
		.poll(() => screen.container.querySelectorAll('[data-asset-media-id] img').length)
		.toBe(1);
	expect(readBlob).toHaveBeenCalledTimes(1);
});

it('reads each thumbnail once while other source thumbnails finish loading', async () => {
	const reads = Array.from({ length: 12 }, () => Promise.withResolvers<Blob | null>());
	mediaPool.loadAll(reads.map((_, index) => source(String(index))));
	vi.mocked(readBlob).mockImplementation((_root, path) => reads[Number(path[1])].promise);
	const screen = await render(MediaPoolList, { projectId: 'thumbnail-reads' });
	await expect.poll(() => vi.mocked(readBlob).mock.calls.length).toBeGreaterThanOrEqual(12);
	for (const [index, read] of reads.entries()) {
		read.resolve(thumbnail);
		await expect
			.poll(() => screen.container.querySelectorAll('[data-asset-media-id] img').length)
			.toBe(index + 1);
	}
	expect(vi.mocked(readBlob).mock.calls.length).toBe(12);
});

it('does not allocate an object URL for a thumbnail completing after the library closes', async () => {
	const read = Promise.withResolvers<Blob | null>();
	vi.mocked(readBlob).mockReturnValue(read.promise);
	mediaPool.loadAll([source('late')]);
	const screen = await render(MediaPoolList, { projectId: 'thumbnail-close' });
	await expect.poll(() => vi.mocked(readBlob).mock.calls.length).toBeGreaterThanOrEqual(1);
	await screen.unmount();
	const create = vi.spyOn(URL, 'createObjectURL');
	read.resolve(thumbnail);
	await read.promise;
	await tick();
	expect(create).not.toHaveBeenCalled();
});

it('keeps the refreshed thumbnail when an older file read completes later', async () => {
	const oldRead = Promise.withResolvers<Blob | null>();
	const newRead = Promise.withResolvers<Blob | null>();
	let currentRead = oldRead;
	vi.mocked(readBlob).mockImplementation(() => currentRead.promise);
	mediaPool.loadAll([source('refresh')]);
	const screen = await render(MediaPoolList, { projectId: 'thumbnail-refresh' });
	await expect.poll(() => vi.mocked(readBlob).mock.calls.length).toBeGreaterThanOrEqual(1);
	currentRead = newRead;
	mediaPool.notifyThumbnailsChanged();
	await tick();
	const fresh = new Blob([(await thumbnail.text()).replace('red', 'blue')], {
		type: thumbnail.type
	});
	newRead.resolve(fresh);
	const imageSource = () =>
		screen.container.querySelector<HTMLImageElement>('[data-asset-media-id] img')?.src;
	await expect.poll(imageSource).toBeTruthy();
	const currentUrl = imageSource();
	expect(await (await fetch(currentUrl!)).text()).toContain('blue');
	oldRead.resolve(thumbnail);
	await oldRead.promise;
	await tick();
	expect(imageSource()).toBe(currentUrl);
});

it('releases local thumbnails without revoking cloud or shared preview URLs', async () => {
	const cloudUrl = URL.createObjectURL(thumbnail);
	try {
		mediaPool.loadAll([
			source('local'),
			{ ...source('cloud'), storageType: 'cloud', remoteThumbnailUrl: cloudUrl }
		]);
		vi.mocked(readBlob).mockResolvedValue(thumbnail);
		const screen = await render(MediaPoolList, { projectId: 'thumbnail-ownership' });
		await expect
			.poll(() => screen.container.querySelectorAll('[data-asset-media-id] img').length)
			.toBe(2);
		const localUrl = screen.container.querySelector<HTMLImageElement>(
			'[data-asset-media-id="local"] img'
		)!.src;
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		mediaPool.remove('local');
		await tick();
		expect(revoke).toHaveBeenCalledWith(localUrl);
		await screen.unmount();
		expect(revoke).not.toHaveBeenCalledWith(cloudUrl);
		expect(await (await fetch(cloudUrl)).text()).toContain('red');
	} finally {
		URL.revokeObjectURL(cloudUrl);
	}
});

it('keeps the pending Color thumbnail read when its clip moves', async () => {
	const read = Promise.withResolvers<Blob | null>();
	vi.mocked(readBlob).mockReturnValue(read.promise);
	mediaPool.loadAll([source('color')]);
	const project = createBlankProject('Color thumbnail');
	project.timeline!.items = [
		{
			id: 'photo',
			type: 'image',
			trackId: 'track-video-main',
			label: 'Photo',
			mediaId: 'color',
			from: 0,
			durationInFrames: 10
		},
		{
			id: 'other-photo',
			type: 'image',
			trackId: 'track-video-main',
			label: 'Other photo',
			mediaId: 'color',
			from: 10,
			durationInFrames: 10
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(ColorMiniTimeline);
	await expect.poll(() => vi.mocked(readBlob).mock.calls.length).toBe(1);
	expect(updateItemProperties('photo', { from: 30 })).toBe(true);
	await tick();
	expect(vi.mocked(readBlob).mock.calls.length).toBe(1);
	read.resolve(thumbnail);
	await expect
		.element(screen.container.querySelector<HTMLElement>('[data-color-film-tile="photo"]')!)
		.toBeVisible();
	await expect
		.poll(
			() =>
				screen.container.querySelector<HTMLImageElement>('[data-color-film-tile="photo"] img')?.src
		)
		.toBeTruthy();
});
