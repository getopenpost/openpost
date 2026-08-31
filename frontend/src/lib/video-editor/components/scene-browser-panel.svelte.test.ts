import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { sceneBrowser } from '$lib/video-editor/media/scene-search/scene-browser.svelte';
import type { SceneAnalysis } from '$lib/video-editor/media/scene-search/types';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import SceneBrowserPanel from './scene-browser-panel.svelte';
import { clearSceneDragData } from '$lib/video-editor/media/scene-search/scene-drag';

const media: MediaMetadata = {
	id: 'media-1',
	storageType: 'workspace',
	fileName: 'cooking.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 8,
	width: 1920,
	height: 1080,
	fps: 24,
	codec: 'h264',
	bitrate: 1_000_000,
	tags: ['video']
};

const analysis: SceneAnalysis = {
	schemaVersion: 1,
	detectorVersion: 2,
	mediaId: media.id,
	sourceFileSize: media.fileSize,
	method: 'adaptive',
	sampleIntervalSec: 0,
	analyzedAt: Date.now(),
	scenes: [
		{
			id: 'media-1:0',
			mediaId: media.id,
			index: 0,
			startSec: 1,
			endSec: 3.5,
			timeSec: 1.2,
			text: 'A cook plates pasta in a bright kitchen',
			palette: [{ l: 53, a: 70, b: 50, weight: 0.7 }]
		}
	]
};

const imageMedia: MediaMetadata = {
	id: 'image-1',
	storageType: 'workspace',
	fileName: 'poster.png',
	fileSize: 50,
	mimeType: 'image/png',
	duration: 0,
	width: 1200,
	height: 800,
	fps: 0,
	codec: 'png',
	bitrate: 0,
	tags: ['image']
};

const imageAnalysis: SceneAnalysis = {
	...analysis,
	mediaId: imageMedia.id,
	method: 'image',
	scenes: [
		{
			id: 'image-1:0',
			mediaId: imageMedia.id,
			index: 0,
			startSec: 0,
			endSec: 3,
			timeSec: 0,
			text: 'A still poster with bold type'
		}
	]
};

beforeEach(() => {
	commandHistory.clearHistory();
	mediaPool.loadAll([media]);
	sceneBrowser.reset();
	sceneBrowser.__setAnalysisForTesting(analysis);
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		fps: 30,
		currentFrame: 60,
		tracks: [
			{
				id: 'video-main',
				name: 'Video',
				kind: 'video',
				height: 64,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 1
			}
		],
		items: []
	});
});

afterEach(() => {
	clearSceneDragData();
	sceneBrowser.reset();
	mediaPool.clear();
});

describe('SceneBrowserPanel', () => {
	it('exports the complete trimmed scene as a timeline drag payload', async () => {
		const screen = await render(SceneBrowserPanel);
		const article = screen.container.querySelector('article');
		expect(article).not.toBeNull();
		const dataTransfer = new DataTransfer();
		article!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		expect(JSON.parse(dataTransfer.getData('application/json'))).toEqual({
			type: 'timeline-scene',
			scene: analysis.scenes[0]
		});
	});

	it('shows indexed scenes and inserts the exact source range at the playhead', async () => {
		const screen = await render(SceneBrowserPanel);

		await expect.element(screen.getByText('A cook plates pasta in a bright kitchen')).toBeVisible();
		await screen
			.getByRole('button', {
				name: 'Add scene at playhead: A cook plates pasta in a bright kitchen'
			})
			.click();

		const inserted = timelineStore.items[0];
		expect(inserted).toMatchObject({
			trackId: 'video-main',
			from: 60,
			durationInFrames: 75,
			sourceStart: 24,
			sourceEnd: 84,
			sourceFps: 24
		});
	});

	it('shows still-image results and inserts them as a fitted image clip', async () => {
		await page.viewport(320, 720);
		mediaPool.loadAll([media, imageMedia]);
		sceneBrowser.__setAnalysisForTesting(imageAnalysis);
		const screen = await render(SceneBrowserPanel);
		screen.container.style.width = '320px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		await page.screenshot({ path: '../../../../.svelte-kit/openpost-scene-images-320.png' });

		await screen
			.getByRole('button', { name: 'Add scene at playhead: A still poster with bold type' })
			.click();

		expect(timelineStore.items[0]).toMatchObject({
			type: 'image',
			mediaId: imageMedia.id,
			from: 60,
			durationInFrames: 90,
			sourceStart: 0,
			sourceDuration: 90,
			sourceFps: undefined,
			transform: { width: 1620, height: 1080 }
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(0);
		await page.viewport(1280, 720);
	});

	it('switches layouts and turns palette swatches into perceptual color searches', async () => {
		const screen = await render(SceneBrowserPanel);
		await screen.getByRole('button', { name: 'List view' }).click();

		await screen.getByRole('button', { name: 'Find scenes with this color' }).click();
		expect(sceneBrowser.query).toBe('red');
		expect(sceneBrowser.sortMode).toBe('relevance');
		await expect.element(screen.getByText('Color')).toBeVisible();
		await expect.element(screen.getByText('A cook plates pasta in a bright kitchen')).toBeVisible();

		await screen.getByRole('button', { name: 'Colors' }).click();
		await expect.element(screen.getByText('Library colors')).toBeVisible();
		await screen.getByRole('button', { name: 'Find a similar palette' }).click();
		expect(sceneBrowser.referencePalette).toEqual(analysis.scenes[0]?.palette);
		expect(sceneBrowser.query).toBe('');
		await expect.element(screen.getByText('Palette')).toBeVisible();
	});
});
