import { page } from 'vitest/browser';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { timelinePreviewScrub } from '../preview/timeline-preview-scrub';
import { updateTextSpan } from '../timeline/actions/text-layout';
import '../../../routes/layout.css';

const nextPaint = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);

it('removes the old hover text when returning to the paused, edited frame', async () => {
	const project = createBlankProject('Hover text');
	project.timeline!.items = [
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			text: 'Title\nOLD',
			textSpans: [
				{ text: 'Title', fontSize: 70 },
				{ text: 'OLD', fontSize: 50 }
			],
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 300,
			fontFamily: 'Arial',
			fontSize: 70,
			color: '#fff',
			transform: { width: 640, height: 360 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	try {
		timelinePreviewScrub.setFrame(20);
		await nextPaint();
		timelinePreviewScrub.clear();
		await nextPaint();
		updateTextSpan('title', 1, { text: 'NEW WORDS' });
		await nextPaint();
		const overlay = screen.container.querySelector<HTMLCanvasElement>('[data-text-scrub-overlay]');
		// No old hover raster may cover the current authored preview after pointer leave.
		expect(overlay === null || !overlay.checkVisibility()).toBe(true);
		const raster = screen.container.querySelector<HTMLCanvasElement>('canvas');
		expect(raster).not.toBeNull();
	} finally {
		await screen.unmount();
		timelinePreviewScrub.clear();
		timelineStore.__resetForTesting();
		editorSession.project = null;
	}
});

it('keeps a scrubbed timer within its authored size and updates its pixels during playback', async () => {
	await page.viewport(1000, 650);
	const project = createBlankProject('Timer preview');
	project.timeline!.items = [
		{
			id: 'timer',
			type: 'text',
			label: 'Tomato',
			text: '00:10',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 300,
			fontFamily: 'Arial',
			fontSize: 72,
			fontWeight: 700,
			color: '#ffffff',
			textAlign: 'center',
			verticalAlign: 'middle',
			timer: { style: 'tomato', direction: 'down', format: 'clock' },
			transform: { width: 420, height: 420, x: 0, y: 0 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	screen.container.style.cssText = 'display:flex;width:960px;height:600px';
	const monitor = screen.getByRole('application', { name: 'Program' }).element();
	// Sample the visible canvas layers in project coordinates, including any stale overlay.
	function pixels() {
		const output = document.createElement('canvas');
		output.width = 1920;
		output.height = 1080;
		const context = output.getContext('2d')!;
		const bounds = monitor.getBoundingClientRect();
		for (const canvas of monitor.querySelectorAll('canvas')) {
			if (!canvas.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
			const rect = canvas.getBoundingClientRect();
			context.drawImage(
				canvas,
				((rect.left - bounds.left) * 1920) / bounds.width,
				((rect.top - bounds.top) * 1080) / bounds.height,
				(rect.width * 1920) / bounds.width,
				(rect.height * 1080) / bounds.height
			);
		}
		return context.getImageData(0, 0, 1920, 1080).data;
	}
	function redBounds() {
		const data = pixels();
		let left = 1920,
			right = -1;
		for (let index = 0; index < data.length; index += 4) {
			if (data[index] > 100 && data[index] > data[index + 1] * 1.5 && data[index + 3] > 128) {
				left = Math.min(left, (index / 4) % 1920);
				right = Math.max(right, (index / 4) % 1920);
			}
		}
		return { left, right };
	}
	try {
		timelinePreviewScrub.setFrame(60);
		await nextPaint();
		await expect.poll(() => redBounds().right).toBeGreaterThan(960);
		expect(redBounds().left).toBeGreaterThanOrEqual(750);
		expect(redBounds().right).toBeLessThanOrEqual(1170);
		timelinePreviewScrub.clear();
		editorSession.clock.seek(60);
		await nextPaint();
		const digitPixels = () => {
			const data = pixels();
			const mask: boolean[] = [];
			for (let y = 500; y < 580; y++) {
				for (let x = 860; x < 1060; x++) {
					const offset = (y * 1920 + x) * 4;
					mask.push(data[offset] > 240 && data[offset + 1] > 240 && data[offset + 2] > 240);
				}
			}
			return mask;
		};
		const pausedDigits = digitPixels();
		expect(pausedDigits.some(Boolean)).toBe(true);
		editorSession.startPlayback({ start: 60, end: 150 });
		await expect.poll(() => timelineStore.currentFrame, { timeout: 3000 }).toBeGreaterThan(90);
		expect(redBounds().left).toBeGreaterThanOrEqual(750);
		expect(redBounds().right).toBeLessThanOrEqual(1170);
		await expect.poll(digitPixels, { timeout: 3000 }).not.toEqual(pausedDigits);
	} finally {
		editorSession.pausePlayback();
		await screen.unmount();
		await page.viewport(1280, 900);
		timelinePreviewScrub.clear();
		timelineStore.__resetForTesting();
		editorSession.project = null;
	}
});
