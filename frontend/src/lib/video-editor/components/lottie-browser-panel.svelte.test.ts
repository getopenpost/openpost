import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

beforeEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	commandHistory.clearHistory();
});

describe('LottieBrowserPanel', () => {
	it('loads, attributes, and imports a public animation in a compact asset panel', async () => {
		const importAnimation = vi.fn(async () => 'media-id');
		const fetchAnimations = vi.fn(async () => ({
			items: [
				{
					id: '42',
					name: 'Wave hello',
					lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
					gifUrl: null,
					bgColor: '#ffffff',
					author: 'Ada',
					authorPath: '/ada'
				}
			],
			endCursor: null,
			hasNextPage: false,
			totalCount: 1
		}));
		const screen = await render(LottieBrowserPanel, {
			projectId: 'project',
			fetchAnimations,
			importAnimation
		});
		await expect.element(screen.getByText('Wave hello')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to media: Wave hello' }).click();
		await vi.waitFor(() => expect(importAnimation).toHaveBeenCalledTimes(1));
		expect(importAnimation).toHaveBeenCalledWith({
			projectId: 'project',
			url: 'https://assets-v2.lottiefiles.com/wave.lottie',
			fileName: 'Wave hello',
			attribution: expect.objectContaining({
				provider: 'LottieFiles',
				author: 'Ada',
				licenseUrl: 'https://lottiefiles.com/page/license'
			})
		});
		await expect
			.element(screen.getByRole('button', { name: 'Added to media: Wave hello' }))
			.toBeVisible();

		screen.container.style.width = '280px';
		const panel = screen.container.querySelector('[aria-label="LottieFiles"]');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(280);
	});

	it('reuses one import when the direct rail inserts the same animation twice', async () => {
		mediaPool.upsert(
			{
				id: 'media-id',
				storageType: 'workspace',
				fileName: 'wave.lottie',
				fileSize: 100,
				mimeType: 'application/zip',
				duration: 2,
				width: 512,
				height: 512,
				fps: 30,
				codec: 'lottie',
				bitrate: 0,
				tags: ['lottie']
			},
			'ready'
		);
		let finishImport: ((mediaId: string) => void) | undefined;
		const importAnimation = vi.fn(() => new Promise<string>((resolve) => (finishImport = resolve)));
		const oninserted = vi.fn();
		const screen = await render(LottieBrowserPanel, {
			projectId: 'project',
			oninserted,
			importAnimation,
			fetchAnimations: vi.fn(async () => ({
				items: [
					{
						id: '42',
						name: 'Wave hello',
						lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
						gifUrl: null,
						bgColor: '#ffffff',
						author: 'Ada',
						authorPath: '/ada'
					}
				],
				endCursor: null,
				hasNextPage: false,
				totalCount: 1
			}))
		});
		const add = screen.getByRole('button', {
			name: 'Add at playhead: Wave hello'
		});
		timelineStore._setCurrentFrame(12);
		await add.click();
		timelineStore._setCurrentFrame(80);
		finishImport?.('media-id');
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(1));
		expect(timelineStore.items[0]?.from).toBe(12);
		await add.click();
		await vi.waitFor(() => expect(timelineStore.items).toHaveLength(2));
		expect(timelineStore.items[1]?.from).toBe(80);
		expect(importAnimation).toHaveBeenCalledTimes(1);
		expect(oninserted).toHaveBeenCalledTimes(2);
	});
});
