import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { strToU8, zipSync } from 'fflate';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { mediaPool } from '../media/pool.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import PreviewLayer from '../components/preview-layer.svelte';
import { LottieRenderer, mapTimelineFrameToLottieFrame } from './frame-provider';

const SIZE = 64;
const FPS = 30;

function shapeLayer(name: string, color: [number, number, number, number], ip: number, op: number) {
	return {
		ddd: 0,
		ind: ip + 1,
		ty: 4,
		nm: name,
		sr: 1,
		ks: {
			o: { a: 0, k: 100 },
			r: { a: 0, k: 0 },
			p: { a: 0, k: [32, 32, 0] },
			a: { a: 0, k: [0, 0, 0] },
			s: { a: 0, k: [100, 100, 100] }
		},
		shapes: [
			{
				ty: 'rc',
				d: 1,
				s: { a: 0, k: [64, 64] },
				p: { a: 0, k: [0, 0] },
				r: { a: 0, k: 0 }
			},
			{ ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: 100 }, r: 1 }
		],
		ip,
		op,
		st: 0,
		bm: 0
	};
}

const animation = JSON.stringify({
	v: '5.12.2',
	fr: FPS,
	ip: 0,
	op: 2,
	w: SIZE,
	h: SIZE,
	nm: 'Frame proof',
	ddd: 0,
	assets: [],
	layers: [shapeLayer('Red', [1, 0, 0, 1], 0, 1), shapeLayer('Green', [0, 1, 0, 1], 1, 2)],
	markers: []
});
const animationBlob = new Blob([animation], { type: 'application/json' });

const track: TimelineTrack = {
	id: 'visuals',
	name: 'Visuals',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'animation',
	trackId: track.id,
	from: 0,
	durationInFrames: 2,
	label: 'Frame proof',
	type: 'lottie',
	mediaId: 'lottie-media',
	sourceStart: 0,
	sourceEnd: 2,
	sourceDuration: 2,
	sourceFps: FPS,
	sourceWidth: SIZE,
	sourceHeight: SIZE,
	lottieFrameRate: FPS,
	lottieTotalFrames: 2,
	lottieLoop: false,
	transform: { width: SIZE, height: SIZE }
};

function project(): Project {
	return {
		id: 'lottie-project',
		name: 'Lottie project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 2 / FPS,
		metadata: {
			width: SIZE,
			height: SIZE,
			fps: FPS,
			backgroundColor: '#000000'
		},
		timeline: { tracks: [track], items: [item] }
	};
}

function registerAnimationMedia(blob: Blob = animationBlob): void {
	// SAFETY: resolveMediaBlob only calls getFile on linked handles in this browser test.
	const fileHandle = {
		getFile: async () => new File([blob], 'proof.json')
	} as FileSystemFileHandle;
	mediaPool.upsert(
		{
			id: 'lottie-media',
			storageType: 'handle',
			fileHandle,
			fileName: 'proof.json',
			fileSize: blob.size,
			mimeType: blob.type || 'application/json',
			duration: 2 / FPS,
			width: SIZE,
			height: SIZE,
			fps: FPS,
			codec: 'lottie',
			bitrate: 0,
			lottieTotalFrames: 2,
			tags: ['lottie']
		},
		'ready'
	);
	// SAFETY: linked media resolves through its file handle before any directory method is used.
	setWorkspaceRoot({ name: 'test' } as FileSystemDirectoryHandle);
}

function centerPixel(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
}

function expectColor(pixel: Uint8ClampedArray, channel: 0 | 1 | 2): void {
	expect(pixel[channel]).toBeGreaterThan(240);
	for (const other of [0, 1, 2] as const) {
		if (other !== channel) expect(pixel[other]).toBeLessThan(15);
	}
	expect(pixel[3]).toBeGreaterThan(240);
}

afterEach(() => {
	mediaPool.clear();
	timelineStore.clear();
	editorSession.project = null;
	setWorkspaceRoot(null);
});

describe('Lottie timeline rendering', () => {
	it('maps loop, ping-pong, reverse, and source segments without skipping endpoints', () => {
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 3,
				projectFps: 1,
				speed: 1,
				totalFrames: 4,
				frameRate: 1,
				loop: true
			})
		).toBe(3);
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 4,
				projectFps: 1,
				speed: 1,
				totalFrames: 4,
				frameRate: 1,
				loop: true
			})
		).toBe(0);
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 4,
				projectFps: 1,
				speed: 1,
				totalFrames: 8,
				frameRate: 1,
				loop: true,
				loopMode: 'pingpong',
				reversed: true,
				segmentStart: 2,
				segmentEnd: 5
			})
		).toBe(3);
	});

	it('renders exact source frames in Chromium preview and export', async () => {
		const sourceUrl = URL.createObjectURL(animationBlob);
		const currentProject = project();
		editorSession.project = currentProject;
		timelineStore.setAll({
			items: [item],
			tracks: [track],
			currentFrame: 0,
			fps: FPS
		});
		registerAnimationMedia();

		try {
			const screen = await render(PreviewLayer, {
				item,
				url: sourceUrl,
				canvasWidth: SIZE,
				canvasHeight: SIZE,
				onselect: vi.fn()
			});
			const preview = screen.container.querySelector<HTMLCanvasElement>('canvas');
			expect(preview).not.toBeNull();
			if (!preview) return;

			await vi.waitFor(() => expectColor(centerPixel(preview), 0), {
				timeout: 15_000
			});
			const exporter = new TimelineFrameRenderer(currentProject);
			try {
				const first = await exporter.render(0);
				expectColor(centerPixel(first), 0);

				timelineStore.setAll({ currentFrame: 1 });
				await vi.waitFor(() => expectColor(centerPixel(preview), 1), {
					timeout: 15_000
				});
				const second = await exporter.render(1);
				expectColor(centerPixel(second), 1);
			} finally {
				exporter.dispose();
			}
		} finally {
			URL.revokeObjectURL(sourceUrl);
		}
	}, 30_000);
});
