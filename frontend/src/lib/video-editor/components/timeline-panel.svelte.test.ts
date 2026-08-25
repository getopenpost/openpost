import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { createTrackGroup } from '$lib/video-editor/timeline/actions/tracks';
import { setEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
import {
	clearSceneDragData,
	setSceneDragData
} from '$lib/video-editor/media/scene-search/scene-drag';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { clearWaveformCache } from '$lib/video-editor/media/waveform-client';
import { saveWaveform } from '$lib/video-editor/media/waveform-persistence';
import { filmstripCache } from '$lib/video-editor/media/filmstrip-client';
import { animatedImageCache } from '$lib/video-editor/media/animated-image-client';
import { animatedFrameIndexAtTime } from '$lib/video-editor/media/animated-image-plan';
import animatedGifUrl from '$lib/video-editor/media/fixtures/animated-rgb.gif?url';

const FILMSTRIP_TILE_WIDTH = 96;
import TimelinePanel from './timeline-panel.svelte';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Video',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 180,
		sourceFps: 30,
		...overrides
	};
}

const sceneMedia: MediaMetadata = {
	id: 'scene-media',
	storageType: 'workspace',
	fileName: 'scene-source.mp4',
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

function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	shiftKey = false,
	clientY = 0,
	altKey = false
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX,
			clientY,
			pointerId: 7,
			shiftKey,
			altKey
		})
	);
}

async function nextAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

beforeEach(() => {
	clearSceneDragData();
	mediaPool.loadAll([sceneMedia]);
	keyboardShortcuts.resetAll();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item({}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		],
		fps: 30
	});
});

describe('TimelinePanel Bento layout entry', () => {
	it('renders persisted waveforms for audio-only timeline clips', async () => {
		const mediaId = `timeline-audio-${crypto.randomUUID()}`;
		mediaPool.loadAll([
			sceneMedia,
			{
				id: mediaId,
				storageType: 'workspace',
				fileName: 'music.wav',
				fileSize: 100,
				mimeType: 'audio/wav',
				duration: 4,
				width: 0,
				height: 0,
				fps: 0,
				codec: 'pcm_s16le',
				bitrate: 128_000,
				tags: ['audio']
			}
		]);
		timelineStore._setItems([
			...timelineStore.items.filter((candidate) => candidate.id !== 'music-bed'),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				mediaId,
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		await saveWaveform(mediaId, {
			peaks: Float32Array.from({ length: 2_000 }, (_, index) => (index % 100) / 100),
			durationSeconds: 4,
			samplesPerSecond: 500,
			loadedSamples: 2_000,
			isComplete: true
		});

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			const clip = screen.getByRole('button', { name: /Music/ });
			await vi.waitFor(() => expect(clip.element().querySelector('svg')).not.toBeNull());
		} finally {
			await clearWaveformCache(mediaId);
		}
	});

	it('fills a long visible clip with sparse tiles and refines only the viewport', async () => {
		const longMedia: MediaMetadata = {
			...sceneMedia,
			id: 'long-video',
			fileName: 'long-video.mp4',
			duration: 3_600
		};
		const offscreenMedia: MediaMetadata = {
			...sceneMedia,
			id: 'offscreen-video',
			fileName: 'offscreen-video.mp4',
			duration: 60
		};
		mediaPool.loadAll([longMedia, offscreenMedia]);
		const longTracks = Array.from({ length: 8 }, (_, index) =>
			track(`long-track-${index}`, 'video', index)
		);
		timelineStore.setAll({
			tracks: longTracks,
			items: [
				item({
					id: 'long-video-clip',
					label: 'Long video',
					trackId: longTracks[0]!.id,
					mediaId: longMedia.id,
					durationInFrames: 108_000,
					sourceEnd: 108_000,
					sourceDuration: 108_000
				}),
				item({
					id: 'offscreen-video-clip',
					label: 'Offscreen video',
					trackId: longTracks[7]!.id,
					mediaId: offscreenMedia.id,
					from: 0,
					durationInFrames: 1_800,
					sourceEnd: 1_800,
					sourceDuration: 1_800
				})
			],
			fps: 30
		});
		const sparseFrames = [0, 600, 1_200, 1_800, 2_400, 3_000, 3_599].map((index) => ({
			index,
			url: `data:image/gif;base64,R0lGODlhAQABAAAAACw=`
		}));
		const subscribe = vi
			.spyOn(filmstripCache, 'subscribe')
			.mockImplementation((mediaId, callback) => {
				if (mediaId === longMedia.id) {
					callback({ frames: sparseFrames, isComplete: false, isExtracting: true, progress: 10 });
				}
				return () => undefined;
			});
		const getFilmstrip = vi.spyOn(filmstripCache, 'getFilmstrip').mockResolvedValue({
			frames: sparseFrames,
			isComplete: false,
			isExtracting: true,
			progress: 10
		});

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			await vi.waitFor(() => expect(getFilmstrip).toHaveBeenCalled());
			expect(getFilmstrip.mock.calls.map(([media]) => media.id)).not.toContain(offscreenMedia.id);

			const clip = screen.getByRole('button', { name: /Long video/ }).element();
			await vi.waitFor(() =>
				expect(clip.querySelectorAll('[data-filmstrip-tile]').length).toBeGreaterThan(3)
			);
			const firstTargets = getFilmstrip.mock.calls[0]?.[1]?.targetFrameIndices ?? [];
			expect(firstTargets.length).toBeGreaterThan(0);
			expect(firstTargets.length).toBeLessThan(40);

			const region = screen.getByRole('region', { name: 'Timeline' }).element();
			region.scrollLeft = 2_000;
			region.dispatchEvent(new Event('scroll'));
			await vi.waitFor(() => expect(getFilmstrip.mock.calls.length).toBeGreaterThan(1));
			const latestTargets = getFilmstrip.mock.calls.at(-1)?.[1]?.targetFrameIndices ?? [];
			expect(latestTargets).not.toEqual(firstTargets);
		} finally {
			subscribe.mockRestore();
			getFilmstrip.mockRestore();
		}
	});

	it('rerenders indexed track rows when clips are added and removed', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await expect.element(screen.getByText('Video', { exact: true })).toBeVisible();

		timelineStore._setItems([
			...timelineStore.items,
			item({ id: 'cutaway', from: 60, label: 'Cutaway' })
		]);
		await expect.element(screen.getByText('Cutaway', { exact: true })).toBeVisible();

		timelineStore._setItems(timelineStore.items.filter((candidate) => candidate.id !== 'cutaway'));
		await expect.element(screen.getByText('Cutaway', { exact: true })).not.toBeInTheDocument();
	});

	it('opens layout work only for a multi-visual unlocked selection', async () => {
		timelineStore._setItems([
			item({
				id: 'video',
				label: 'Video',
				sourceWidth: 1920,
				sourceHeight: 1080
			}),
			item({
				id: 'cutaway',
				label: 'Cutaway',
				sourceWidth: 1080,
				sourceHeight: 1920
			})
		]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video',
			selectedItemIds: ['video', 'cutaway'],
			canvasWidth: 1280,
			canvasHeight: 720
		});

		const arrange = screen.getByRole('button', {
			name: 'Arrange selected clips'
		});
		await expect.element(arrange).toBeEnabled();
		await arrange.click();
		await expect.element(screen.getByRole('dialog', { name: 'Arrange clips' })).toBeVisible();
	});
});

describe('TimelinePanel sync-lock ripple trim', () => {
	it('offers freeze-frame insertion only at an eligible video frame', async () => {
		timelineStore._setCurrentFrame(20);
		const onfreezeframe = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			onfreezeframe,
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});

		const freeze = screen.getByRole('button', { name: 'Freeze frame' });
		await expect.element(freeze).toBeEnabled();
		await freeze.click();
		expect(onfreezeframe).toHaveBeenCalledWith('video');

		timelineStore._setCurrentFrame(0);
		await expect.element(freeze).toBeDisabled();
	});

	it('exposes the persisted audio-skimming control', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const enabled = screen.getByRole('button', {
			name: 'Disable audio skimming'
		});
		await expect.element(enabled).toHaveAttribute('aria-pressed', 'true');
		await enabled.click();
		const disabled = screen.getByRole('button', {
			name: 'Enable audio skimming'
		});
		await expect.element(disabled).toHaveAttribute('aria-pressed', 'false');
		await disabled.click();
	});

	it('fits, resets, shortcuts, and coalesces pointer-anchored wheel zoom', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		region!.style.width = '1000px';
		region!.style.maxWidth = '1000px';
		region!.style.overflow = 'auto';
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 300));
		await nextAnimationFrame();
		expect(region!.clientWidth).toBe(1_000);

		await screen.getByRole('button', { name: 'Fit timeline' }).click();
		expect(timelineStore.zoomLevel).toBeCloseTo(770 / (300 * 4));
		expect(region!.scrollLeft).toBe(0);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '=',
				ctrlKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		expect(timelineStore.zoomLevel).toBeCloseTo((770 / (300 * 4)) * 1.15);

		timelineStore._setZoomLevel(1);
		await nextAnimationFrame();
		expect(region!.scrollWidth).toBeGreaterThan(1_000);
		region!.scrollLeft = 200;
		expect(region!.scrollLeft).toBe(200);
		const firstWheel = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			clientX: 500,
			ctrlKey: true,
			deltaY: -100
		});
		const secondWheel = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			clientX: 500,
			ctrlKey: true,
			deltaY: -100
		});
		region!.dispatchEvent(firstWheel);
		region!.dispatchEvent(secondWheel);
		expect(firstWheel.defaultPrevented).toBe(true);
		expect(timelineStore.zoomLevel).toBe(1);
		expect(region!.scrollLeft).toBe(200);
		await nextAnimationFrame();
		expect(timelineStore.zoomLevel).toBeCloseTo(1.15 * 1.15);
		await nextAnimationFrame();
		expect(region!.scrollLeft).toBeCloseTo(367.7, 0);

		region!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
		timelineStore._setCurrentFrame(200);
		await screen.getByRole('button', { name: 'Zoom timeline to 100%' }).click();
		expect(timelineStore.zoomLevel).toBe(1);
		expect(region!.scrollLeft).toBe(390);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '\\',
				code: 'Backslash',
				bubbles: true,
				cancelable: true
			})
		);
		expect(timelineStore.zoomLevel).toBeCloseTo(770 / (300 * 4));
		expect(region!.scrollLeft).toBe(0);
	});

	it('uses a saved custom binding for timeline commands', async () => {
		await render(TimelinePanel, { onedit: vi.fn() });
		timelineStore._setZoomLevel(1);
		keyboardShortcuts.setBinding('ZOOM_IN', 'alt+8');

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '8',
				code: 'Digit8',
				altKey: true,
				bubbles: true,
				cancelable: true
			})
		);

		expect(timelineStore.zoomLevel).toBeCloseTo(1.15);
	});

	it('scrubs the ruler with pointer drag and precise keyboard steps', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		const ruler = screen.getByRole('slider', { name: 'Timeline playhead' });

		dispatchPointer(ruler.element(), 'pointerdown', 220);
		dispatchPointer(window, 'pointermove', 260);
		await nextAnimationFrame();
		dispatchPointer(window, 'pointerup', 260);
		expect(timelineStore.currentFrame).toBe(20);
		await expect.element(ruler).toHaveAttribute('aria-valuenow', '20');

		ruler
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(timelineStore.currentFrame).toBe(21);
		ruler.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.currentFrame).toBe(11);
		ruler.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		expect(timelineStore.currentFrame).toBe(120);
	});

	it('resizes one track as one undoable pointer gesture', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resize = screen.getByRole('slider', {
			name: 'Resize video-track track height'
		});

		dispatchPointer(resize.element(), 'pointerdown', 0, false, 100);
		dispatchPointer(window, 'pointermove', 0, false, 130);
		expect(timelineStore.tracks.find((candidate) => candidate.id === 'video-track')?.height).toBe(
			94
		);
		expect(onedit).not.toHaveBeenCalled();
		dispatchPointer(window, 'pointerup', 0, false, 130);
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('RESIZE_TRACK_HEIGHT');
		await expect.element(resize).toHaveAttribute('aria-valuenow', '94');

		commandHistory.undo();
		expect(timelineStore.tracks.find((candidate) => candidate.id === 'video-track')?.height).toBe(
			64
		);
	});

	it('supports resize-all, cancellation, keyboard bounds, and reset', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const audioResize = screen.getByRole('slider', {
			name: 'Resize audio-track track height'
		});

		dispatchPointer(audioResize.element(), 'pointerdown', 0, false, 100, true);
		dispatchPointer(window, 'pointermove', 0, false, 110);
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([74, 74]);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([64, 64]);
		expect(onedit).not.toHaveBeenCalled();

		audioResize.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'End',
				altKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([140, 140]);
		const videoResize = screen.getByRole('slider', {
			name: 'Resize video-track track height'
		});
		videoResize
			.element()
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true }));
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([96, 72]);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('renders, selects, edits, and deletes project markers', async () => {
		timelineStore.setAll({
			markers: [{ id: 'marker-1', frame: 10, color: '#d97746' }]
		});
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const marker = screen.getByRole('button', { name: 'Marker 1, Frame 10' });
		await marker.click();
		expect(timelineStore.selectedMarkerId).toBe('marker-1');
		expect(timelineStore.currentFrame).toBe(10);

		const label = screen.getByLabelText('Label');
		await label.fill('Beat drop');
		label.element().dispatchEvent(new FocusEvent('blur'));
		expect(timelineStore.markers[0]?.label).toBe('Beat drop');

		const frame = screen.getByRole('spinbutton', {
			name: 'Frame',
			exact: true
		});
		await frame.fill('33');
		frame.element().dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.markers[0]?.frame).toBe(33);
		expect(timelineStore.currentFrame).toBe(33);

		const color = screen.getByLabelText('Color').element();
		if (!(color instanceof HTMLInputElement)) throw new Error('Expected marker color input.');
		color.value = '#22c55e';
		color.dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.markers[0]?.color).toBe('#22c55e');

		await screen.getByRole('button', { name: 'Delete marker' }).click();
		expect(timelineStore.markers).toEqual([]);
		expect(timelineStore.selectedMarkerId).toBeNull();
		expect(onedit).toHaveBeenCalledTimes(4);
	});

	it('drags markers atomically and navigates to adjacent markers', async () => {
		timelineStore.setAll({
			markers: [
				{ id: 'first', frame: 10, color: '#d97746' },
				{ id: 'middle', frame: 40, color: '#3b82f6', label: 'Middle' },
				{ id: 'last', frame: 90, color: '#22c55e' }
			]
		});
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		const first = screen.getByRole('button', { name: 'Marker 1, Frame 10' });

		dispatchPointer(first.element(), 'pointerdown', 220);
		dispatchPointer(window, 'pointermove', 260);
		dispatchPointer(window, 'pointerup', 260);
		expect(timelineStore.markers.find((marker) => marker.id === 'first')?.frame).toBe(20);
		expect(commandHistory.getLastCommandType()).toBe('MOVE_MARKER');
		expect(onedit).toHaveBeenCalledOnce();

		timelineStore._setCurrentFrame(50);
		await screen.getByRole('button', { name: 'Previous marker' }).click();
		expect(timelineStore.currentFrame).toBe(40);
		expect(timelineStore.selectedMarkerId).toBe('middle');
		await screen.getByRole('button', { name: 'Next marker' }).click();
		expect(timelineStore.currentFrame).toBe(90);

		const last = screen.getByRole('button', { name: 'Marker 3, Frame 90' });
		last.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(80);
		await nextAnimationFrame();

		const movedLast = screen.getByRole('button', {
			name: 'Marker 3, Frame 80'
		});
		dispatchPointer(movedLast.element(), 'pointerdown', 500);
		dispatchPointer(window, 'pointermove', 300);
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(30);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(80);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('joins selected split siblings from the toolbar and Shift+J', async () => {
		const left = item({
			id: 'left',
			originId: 'origin',
			mediaId: 'media',
			durationInFrames: 30,
			sourceEnd: 30
		});
		const right = item({
			id: 'right',
			originId: 'origin',
			mediaId: 'media',
			from: 30,
			durationInFrames: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		timelineStore._setItems([left, right]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'right',
			selectedItemIds: ['left', 'right']
		});
		const join = screen.getByRole('button', { name: 'Join selected clips' });
		await expect.element(join).toBeEnabled();
		await join.click();
		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			id: 'left',
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60
		});
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);
	});

	it('joins selected split siblings with Shift+J', async () => {
		timelineStore._setItems([
			item({
				id: 'left',
				originId: 'origin',
				mediaId: 'media',
				durationInFrames: 30,
				sourceEnd: 30
			}),
			item({
				id: 'right',
				originId: 'origin',
				mediaId: 'media',
				from: 30,
				durationInFrames: 30,
				sourceStart: 30,
				sourceEnd: 60
			})
		]);
		const onedit = vi.fn();
		await render(TimelinePanel, {
			onedit,
			selectedItemId: 'right',
			selectedItemIds: ['left', 'right']
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', shiftKey: true, bubbles: true }));
		expect(timelineStore.items).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('previews and inserts a dragged scene at the exact pointer frame', async () => {
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const scene = {
			id: 'scene-media:0',
			mediaId: sceneMedia.id,
			index: 0,
			startSec: 1,
			endSec: 3.5,
			timeSec: 1.2,
			text: 'A cook plates pasta'
		};
		const payload = { type: 'timeline-scene' as const, scene };
		setSceneDragData(payload);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('application/json', JSON.stringify(payload));
		const trackRect = videoTrack!.getBoundingClientRect();
		const clientX = trackRect.left + 180 + 100 * 4;

		videoTrack!.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		expect(document.querySelector('[data-scene-drop-preview]')).not.toBeNull();

		videoTrack!.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		const inserted = timelineStore.items.find((candidate) => candidate.mediaId === sceneMedia.id);
		expect(inserted).toMatchObject({
			trackId: 'video-track',
			from: 100,
			durationInFrames: 75,
			sourceStart: 24,
			sourceEnd: 84,
			sourceFps: 24
		});
		expect(document.querySelector('[data-scene-drop-preview]')).toBeNull();
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('previews and applies a dropped effect to compatible selected clips', async () => {
		timelineStore._setTracks([
			track('video-track', 'video', 0),
			track('audio-track', 'audio', 1),
			{ ...track('locked-track', 'video', 2), locked: true }
		]);
		timelineStore._setItems([
			item({}),
			item({
				id: 'title',
				label: 'Title',
				type: 'text',
				from: 70,
				sourceStart: undefined,
				sourceEnd: undefined
			}),
			item({
				id: 'locked-video',
				trackId: 'locked-track',
				label: 'Locked video',
				from: 140
			}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video', 'title', 'music-bed', 'locked-video']
		});
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const titleClip = screen.getByRole('button', { name: /^Title\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const lockedClip = screen
			.getByRole('button', { name: /^Locked video\./ })
			.element().parentElement!;
		const payload = {
			type: 'timeline-effect' as const,
			label: 'Brightness',
			effects: [{ kind: 'css' as const, effectType: 'brightness' as const }]
		};
		setEffectDragData(payload);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('application/json', JSON.stringify(payload));

		videoClip.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				clientX: 100,
				clientY: 100,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		const videoPreview = videoClip.querySelector<HTMLElement>('[data-effect-drop-preview]');
		expect(videoPreview).not.toBeNull();
		expect(videoPreview?.className).toContain('oklch(0.66_0.14_45');
		expect(titleClip.querySelector('[data-effect-drop-preview]')).not.toBeNull();
		expect(musicClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(lockedClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(videoClip.textContent).toContain('2 clips');

		videoClip.dispatchEvent(
			new DragEvent('drop', {
				bubbles: true,
				clientX: 100,
				clientY: 100,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')?.effects).toEqual([
			expect.objectContaining({
				type: 'brightness',
				amount: 1.2,
				enabled: true
			})
		]);
		expect(timelineStore.itemById.get('title')?.effects).toEqual([
			expect.objectContaining({
				type: 'brightness',
				amount: 1.2,
				enabled: true
			})
		]);
		expect(timelineStore.itemById.get('music-bed')?.effects).toBeUndefined();
		expect(timelineStore.itemById.get('locked-video')?.effects).toBeUndefined();
		expect(document.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('marquee-selects every clip intersecting a background drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const videoRect = videoClip.getBoundingClientRect();
		const musicRect = musicClip.getBoundingClientRect();

		dispatchPointer(
			videoTrack!,
			'pointerdown',
			Math.max(videoRect.right, musicRect.right) + 20,
			false,
			videoRect.top + videoRect.height / 2
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 1,
				clientX: Math.min(videoRect.left, musicRect.left) - 5,
				clientY: musicRect.top + musicRect.height / 2,
				pointerId: 7
			})
		);
		await nextAnimationFrame();
		expect(document.querySelector('[data-timeline-marquee]')).not.toBeNull();
		dispatchPointer(window, 'pointerup', Math.min(videoRect.left, musicRect.left) - 5);
		await nextAnimationFrame();

		expect(videoClip.className).toContain('ring-1');
		expect(musicClip.className).toContain('ring-1');
		expect(document.querySelector('[data-timeline-marquee]')).toBeNull();
	});

	it('previews every touched track and commits the split as one undo entry', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const videoButton = screen.getByRole('button', { name: /^Video\./ }).element();
		const videoClip = videoButton.parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('440px');
		expect(timelineStore.itemById.get('music-bed')?.durationInFrames).toBe(120);

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(
			timelineStore.items
				.filter((candidate) => candidate.trackId === 'audio-track')
				.sort((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 50, sourceStart: 0, sourceEnd: 50 },
			{ from: 50, durationInFrames: 60, sourceStart: 60, sourceEnd: 120 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RIPPLE_EDIT');
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({
				id: 'music-bed',
				from: 0,
				durationInFrames: 120
			})
		]);
	});

	it('returns to a normal trim when Shift is released during the drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('480px');
		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(timelineStore.itemById.get('music-bed')).toMatchObject({
			from: 0,
			durationInFrames: 120
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');
	});

	it('restores the whole ripple preview on Escape without adding history', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({
				id: 'music-bed',
				from: 0,
				durationInFrames: 120
			})
		]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('hides and removes a transition when its clip edge is trimmed directly', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const ontransitionbreak = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			ontransitionbreak
		});
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();
		expect(document.querySelector('[data-transition-id="transition"]')).not.toBeNull();
		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointerup', 400);
		await nextAnimationFrame();
		expect(transitionsStore.list).toHaveLength(1);
		expect(ontransitionbreak).not.toHaveBeenCalled();
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		expect(document.querySelector('[data-transition-id="transition"]')).toBeNull();

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(transitionsStore.list).toEqual([]);
		expect(ontransitionbreak).toHaveBeenCalledOnce();
		expect(ontransitionbreak).toHaveBeenCalledWith(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({
				id: 'transition',
				fromItemId: 'video',
				toItemId: 'next-video'
			})
		]);
	});

	it('selects and resizes a transition as one undoable pointer edit', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});
		const transition = document.querySelector<HTMLElement>('[data-transition-id="transition"]');
		expect(transition).not.toBeNull();
		transition
			?.querySelector<HTMLButtonElement>('button[aria-label="Transition"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await nextAnimationFrame();
		expect(transition?.className).toContain('ring-2');
		expect(
			screen.getByRole('button', { name: /^Video\./ }).element().parentElement?.className
		).not.toContain('ring-1');

		const resizeEnd = screen.getByRole('button', { name: 'Resize transition end' }).element();
		dispatchPointer(resizeEnd, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 320);
		await nextAnimationFrame();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
		expect(transition?.style.width).toBe('60px');

		dispatchPointer(window, 'pointerup', 320);
		await nextAnimationFrame();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(15);
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_TRANSITION');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
	});

	it('cancels a transition resize on Escape without saving or history', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resizeStart = screen.getByRole('button', { name: 'Resize transition start' }).element();
		dispatchPointer(resizeStart, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 280);
		await nextAnimationFrame();
		expect(
			document.querySelector<HTMLElement>('[data-transition-id="transition"]')?.style.width
		).toBe('60px');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();

		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(onedit).not.toHaveBeenCalled();
	});

	it('resizes a selected transition by frame from the keyboard', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 20,
				sourceEnd: 80
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resizeEnd = screen.getByRole('button', { name: 'Resize transition end' }).element();
		resizeEnd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(transitionsStore.list[0]?.durationInFrames).toBe(11);
		resizeEnd.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(transitionsStore.list[0]?.durationInFrames).toBe(21);
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});

describe('TimelinePanel track groups', () => {
	it('groups selected track names and collapses only their timeline rows', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const videoName = screen.getByRole('button', { name: 'video-track' }).element();
		const audioName = screen.getByRole('button', { name: 'audio-track' }).element();
		videoName.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		audioName.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

		await screen.getByRole('button', { name: 'Group selected tracks' }).click();
		expect(timelineStore.tracks.filter((track) => track.isGroup)).toHaveLength(1);
		expect(timelineStore.tracks.filter((track) => track.parentTrackId)).toHaveLength(2);
		await expect.element(screen.getByText('Track group 1')).toBeVisible();
		const groupRow = document.querySelector<HTMLElement>(
			'[data-track][aria-label="Track group 1"]'
		)!;
		const groupHeader = groupRow.querySelector<HTMLElement>('[data-track-header]')!;
		const groupBottom = groupRow.getBoundingClientRect().bottom;
		expect(
			Math.max(
				...[...groupHeader.querySelectorAll<HTMLElement>('[data-track-primary-control]')].map(
					(button) => button.getBoundingClientRect().bottom
				)
			)
		).toBeLessThanOrEqual(groupBottom);

		await screen.getByRole('button', { name: 'Collapse track group' }).click();
		expect(document.querySelector('[data-track="video-track"]')).toBeNull();
		expect(document.querySelector('[data-track="audio-track"]')).toBeNull();
		expect(timelineStore.items).toHaveLength(2);
		await screen.getByRole('button', { name: 'Expand track group' }).click();
		expect(document.querySelector('[data-track="video-track"]')).not.toBeNull();
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('keeps clips on ungroup and confirms before deleting group contents', async () => {
		const groupId = createTrackGroup(['video-track'], 'Production')!;
		commandHistory.clearHistory();
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await screen.getByRole('button', { name: 'More track actions' }).nth(0).click();
		await screen.getByRole('menuitem', { name: 'Ungroup and keep tracks' }).click();
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(false);

		commandHistory.undo();
		await screen.getByRole('button', { name: 'More track actions' }).nth(0).click();
		await screen.getByRole('menuitem', { name: 'Delete group and tracks' }).click();
		await expect.element(screen.getByText('Delete group and its tracks?')).toBeVisible();
		await expect
			.element(screen.getByText(/Ungroup instead if you want to keep the tracks/))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Delete group and tracks' }).click();
		expect(timelineStore.items.map((item) => item.id)).toEqual(['music-bed']);
		expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(false);
	});
});

const FRAME_COLORS = [
	[220, 38, 38],
	[22, 163, 74],
	[37, 99, 235]
] as const;

function colorName(r: number, g: number, b: number): string {
	if (r > 150 && g < 120) return 'red';
	if (g > 100 && r < 120) return 'green';
	if (b > 150) return 'blue';
	return `unknown(${r},${g},${b})`;
}

describe('TimelinePanel animated image filmstrips', () => {
	it('tiles animated GIF clips with the exact frame playing under each slot', async () => {
		const blob = await (await fetch(animatedGifUrl)).blob();
		const mediaId = `animated-image-${crypto.randomUUID()}`;
		mediaPool.loadAll([
			{
				id: mediaId,
				// SAFETY: extraction only reads getFile from this stub handle.
				fileHandle: { getFile: async () => new File([blob], 'animated.gif') },
				storageType: 'handle',
				fileName: 'animated.gif',
				fileSize: blob.size,
				mimeType: 'image/gif',
				duration: 0.3,
				width: 16,
				height: 12,
				fps: 10,
				codec: '',
				bitrate: 0,
				animationFrameCount: 3,
				tags: ['image']
			}
		]);
		timelineStore._setItems([
			...timelineStore.items,
			item({
				id: 'animated-clip',
				label: 'Animated GIF',
				type: 'image',
				mediaId,
				durationInFrames: 300,
				sourceWidth: 16,
				sourceHeight: 12
			})
		]);

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			const clip = screen.getByRole('button', { name: /Animated GIF/ }).element();
			await vi.waitFor(() => {
				expect(clip.querySelectorAll('[data-filmstrip-tile]').length).toBeGreaterThan(2);
			});

			// Real extracted frames, real delays: verify each tile paints the same
			// frame the timing math predicts for its center position.
			const frames = await animatedImageCache.getAnimatedImage(mediaPool.get(mediaId)!);
			expect(frames.durationsMs).toEqual([100, 100, 100]);
			const tiles = [...clip.querySelectorAll<HTMLCanvasElement>('[data-filmstrip-tile]')];
			const clipWidth = 300 * 4; // default zoom renders 4 px per frame
			const tileWidth = FILMSTRIP_TILE_WIDTH;
			tiles.forEach((canvas, slot) => {
				const context = canvas.getContext('2d');
				expect(context).not.toBeNull();
				const data = context!.getImageData(8, 6, 1, 1).data;
				const painted = colorName(data![0]!, data![1]!, data![2]!);
				const ratio = (slot * tileWidth + tileWidth / 2) / clipWidth;
				const expectedIndex = animatedFrameIndexAtTime(
					frames.cumulativeDelaysMs,
					frames.totalDurationMs,
					ratio * (300 / 30) * 1000
				);
				expect(painted).toBe(colorName(...FRAME_COLORS[expectedIndex]!));
			});
		} finally {
			await animatedImageCache.clearMedia(mediaId);
		}
	});
});
