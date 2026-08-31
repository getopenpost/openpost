import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import type {
	GeneratedMusic,
	GenerateLocalMusicOptions,
	MusicGenerationStorageStatus
} from '$lib/video-editor/local-ai/music/ace-step-service';
import { ACE_STEP_STANDARD_DOWNLOAD_BYTES } from '$lib/video-editor/local-ai/music/ace-step-service';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
import LocalMusicPanel from './local-music-panel.svelte';
import '../../../routes/layout.css';

const result: GeneratedMusic = {
	blob: new Blob([new Uint8Array(96)], { type: 'audio/wav' }),
	file: new File([new Uint8Array(96)], 'ai-music-cinematic-73.wav', { type: 'audio/wav' }),
	duration: 10,
	sampleRate: 48_000,
	seed: 73,
	model: 'ace-step-1.5-xl-turbo',
	audioQuality: 'standard',
	prompt: 'Cinematic pulse'
};

const media: MediaMetadata = {
	id: 'music-media',
	storageType: 'workspace',
	fileName: result.file.name,
	fileSize: 96,
	mimeType: 'audio/wav',
	duration: 10,
	width: 0,
	height: 0,
	fps: 0,
	codec: '',
	bitrate: 160,
	tags: ['audio', 'ai-generated', 'music', 'ace-step']
};

const enoughStorage: MusicGenerationStorageStatus = {
	expectedBytes: 5_626_494_229,
	readyBytes: 0,
	missingBytes: 5_626_494_229,
	headroomBytes: 512_000_000,
	availableBytes: 10_000_000_000,
	effectiveAvailableBytes: 10_000_000_000,
	sufficient: true,
	persisted: true
};

beforeEach(() => {
	mediaTasks.reset();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 147 });
});

describe('LocalMusicPanel', () => {
	it('shows the cold-download contract, progress, preview, and durable insert path', async () => {
		let finishGeneration!: () => void;
		const generationGate = new Promise<void>((resolve) => {
			finishGeneration = resolve;
		});
		const generateMusic = vi.fn(async (options: GenerateLocalMusicOptions) => {
			options.onProgress?.({
				stage: 'downloading',
				message: 'Downloading ACE-Step DiT',
				progress: 0.25,
				backend: 'webgpu',
				receivedBytes: 1_406_623_557,
				totalBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES
			});
			await generationGate;
			return result;
		});
		const commitAudio = vi
			.fn()
			.mockResolvedValueOnce({ media })
			.mockResolvedValueOnce({ media, itemId: 'music-item' });
		const oninserted = vi.fn();
		const screen = await render(LocalMusicPanel, {
			projectId: 'project-1',
			oninserted,
			generateMusic,
			commitAudio,
			inspectStorage: vi.fn(async () => enoughStorage),
			supported: true
		});
		screen.container.style.width = '260px';
		screen.container.style.height = '720px';

		await expect.element(screen.getByText(/First use downloads up to 5.42 GB/)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Generate music' })).toBeEnabled();
		const sliderEl = screen.getByRole('slider', { name: 'Length' }).element();
		sliderEl.focus();
		sliderEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		sliderEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true }));
		await new Promise((r) => setTimeout(r, 50));
		await screen.getByRole('button', { name: 'Generate music' }).click();
		expect(generateMusic).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 2 }));
		await expect.element(screen.getByText('Downloading ACE-Step DiT')).toBeVisible();
		expect(mediaTasks.get(mediaTaskId('music-generation', 'project-1'))).toEqual(
			expect.objectContaining({ progress: 0.25, totalBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES })
		);
		finishGeneration();
		await expect.element(screen.getByRole('article').getByText('Cinematic pulse')).toBeVisible();
		const article = screen.container.querySelector('article');
		const audio = screen.container.querySelector('audio');
		if (!article || !audio) throw new Error('Expected a generated music preview.');
		const containerBounds = screen.container.getBoundingClientRect();
		for (const element of [article, audio]) {
			const bounds = element.getBoundingClientRect();
			expect(bounds.left).toBeGreaterThanOrEqual(containerBounds.left - 0.5);
			expect(bounds.right).toBeLessThanOrEqual(containerBounds.right + 0.5);
		}
		expect(getComputedStyle(article).overflowX).toBe('hidden');
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-local-music-panel.png'
		});

		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await screen.getByRole('button', { name: 'Save & Insert' }).click();
		expect(commitAudio).toHaveBeenLastCalledWith(
			result,
			expect.objectContaining({
				projectId: 'project-1',
				existingMediaId: media.id,
				insertAtFrame: 147,
				tags: expect.arrayContaining(['music', 'ace-step', 'ace-step-quality:standard'])
			})
		);
		expect(oninserted).toHaveBeenCalledWith('music-item');
	});

	it('switches to the full precision model without hiding its storage cost', async () => {
		const generateMusic = vi.fn(async () => ({ ...result, audioQuality: 'high' as const }));
		const screen = await render(LocalMusicPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateMusic,
			commitAudio: vi.fn(),
			inspectStorage: vi.fn(async () => enoughStorage),
			supported: true
		});

		await screen.getByRole('button', { name: 'Model', exact: true }).click();
		await page.getByRole('option', { name: /High/ }).click();
		await expect.element(screen.getByText(/First use downloads up to 7.79 GB/)).toBeVisible();
		await screen.getByRole('button', { name: 'Generate music' }).click();
		expect(generateMusic).toHaveBeenCalledWith(
			expect.objectContaining({ audioQuality: 'high', durationSeconds: 10 })
		);
	});

	it('blocks generation before download when the current origin cannot fit the model', async () => {
		const screen = await render(LocalMusicPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateMusic: vi.fn(),
			commitAudio: vi.fn(),
			inspectStorage: vi.fn(async () => ({
				...enoughStorage,
				availableBytes: 1_140_000_000,
				effectiveAvailableBytes: 1_140_000_000,
				sufficient: false
			})),
			supported: true
		});

		await expect.element(screen.getByText(/has 1.14 GB available but needs 6.14 GB/)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Generate music' })).toBeDisabled();
	});
});
