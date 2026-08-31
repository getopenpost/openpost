import { describe, expect, it, vi } from 'vitest';
import type { Project, TimelineItem } from '$lib/video-editor/project/types';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { renderTimelineFrame, renderMultiTrackVideoArtifact } from './render-export';
import { BlobSource, CanvasSink, Input, WebMInputFormat } from 'mediabunny';
import animatedGifUrl from './fixtures/animated-rgb.gif?url';

const WIDTH = 64;
const HEIGHT = 48;
let mediaSeq = 0;

async function buildProject(
	itemOverrides: Partial<TimelineItem> = {}
): Promise<{ project: Project; item: TimelineItem }> {
	const blob = await (await fetch(animatedGifUrl)).blob();
	const mediaId = `export-anim-${++mediaSeq}`;
	mediaPool.loadAll([
		{
			id: mediaId,
			// SAFETY: resolveMediaBlob only reads getFile from this stub handle.
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
	const item: TimelineItem = {
		id: 'anim',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 30,
		label: 'Animated',
		type: 'image',
		mediaId,
		sourceWidth: 16,
		sourceHeight: 12,
		transform: { width: WIDTH, height: HEIGHT },
		...itemOverrides
	};
	const project: Project = {
		id: 'animated-export-project',
		name: 'Animated export project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [
				{
					id: 'visuals',
					name: 'Visuals',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		}
	};
	return { project, item };
}

async function pngCenterColor(frameBlob: Blob): Promise<string> {
	const bitmap = await createImageBitmap(await frameBlob.arrayBuffer().then((b) => new Blob([b])));
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d');
	context?.drawImage(bitmap, 0, 0);
	const data = context?.getImageData(
		Math.floor(canvas.width / 2),
		Math.floor(canvas.height / 2),
		1,
		1
	).data;
	const [r, g, b] = [data![0]!, data![1]!, data![2]!];
	if (r > 150 && g < 120) return 'red';
	if (g > 100 && r < 120) return 'green';
	if (b > 150) return 'blue';
	return `unknown(${r},${g},${b})`;
}

describe('animated image export and still capture', () => {
	it('captures the correct animation frame for stills at any playhead position', async () => {
		const { project } = await buildProject();

		// Frame 0 -> red, frame 5 (~166ms) -> green, frame 15 (500ms loops to
		// 200ms) -> blue.
		expect(await pngCenterColor(await renderTimelineFrame(project, 0))).toBe('red');
		expect(await pngCenterColor(await renderTimelineFrame(project, 5))).toBe('green');
		expect(await pngCenterColor(await renderTimelineFrame(project, 15))).toBe('blue');

		// Speed 2 at frame 15 = 1000ms of animation time -> 100ms bucket green.
		const fast = await buildProject({ speed: 2 });
		expect(await pngCenterColor(await renderTimelineFrame(fast.project, 15))).toBe('green');

		// Reversed at frame 15 has advanced 500ms. The 300ms loop leaves 200ms
		// elapsed backward from the exclusive end, which is the red bucket.
		const reversed = await buildProject({ isReversed: true });
		expect(await pngCenterColor(await renderTimelineFrame(reversed.project, 15))).toBe('red');
	});

	it('renders a composed video where animation timing survives end to end', async () => {
		const { project } = await buildProject();
		const artifact = await renderMultiTrackVideoArtifact(project, {
			format: 'webm',
			width: WIDTH,
			height: HEIGHT
		});
		expect(artifact.renderMethod).toBe('rendered');
		expect(artifact.blob.size).toBeGreaterThan(0);

		// Decode the exported file and verify frames at t=0 and t=0.133s.
		const input = new Input({
			source: new BlobSource(artifact.blob),
			formats: [new WebMInputFormat()]
		});
		try {
			const track = await input.getPrimaryVideoTrack();
			expect(track).not.toBeNull();
			const sink = new CanvasSink(track!, { width: 8, height: 6, fit: 'fill', poolSize: 2 });
			const first = await sink.getCanvas(0);
			const later = await sink.getCanvas(0.133);
			expect(first).not.toBeNull();
			expect(later).not.toBeNull();
			const colorAt = (wrapped: NonNullable<Awaited<ReturnType<typeof sink.getCanvas>>>) => {
				const context = wrapped.canvas.getContext('2d');
				const data = context?.getImageData(4, 3, 1, 1).data;
				const [r, g, b] = [data![0]!, data![1]!, data![2]!];
				if (r > 150 && g < 120) return 'red';
				if (g > 100 && r < 120) return 'green';
				if (b > 150) return 'blue';
				return `unknown(${r},${g},${b})`;
			};
			expect(colorAt(first!)).toBe('red');
			expect(colorAt(later!)).toBe('green');
		} finally {
			input.dispose?.();
		}
	}, 30_000);

	it('renders only the selected in/out range while preserving absolute timeline time', async () => {
		const { project } = await buildProject();
		const artifact = await renderMultiTrackVideoArtifact(project, {
			format: 'webm',
			width: WIDTH,
			height: HEIGHT,
			range: { startFrame: 3, endFrame: 9 }
		});
		const input = new Input({
			source: new BlobSource(artifact.blob),
			formats: [new WebMInputFormat()]
		});
		try {
			const track = await input.getPrimaryVideoTrack();
			expect(track).not.toBeNull();
			expect(await track!.computeDuration()).toBeCloseTo(0.2, 2);
			const sink = new CanvasSink(track!, { width: 8, height: 6, fit: 'fill', poolSize: 2 });
			const first = await sink.getCanvas(0);
			const later = await sink.getCanvas(0.1);
			expect(first).not.toBeNull();
			expect(later).not.toBeNull();
			const colorAt = (wrapped: NonNullable<Awaited<ReturnType<typeof sink.getCanvas>>>) => {
				const data = wrapped.canvas.getContext('2d')?.getImageData(4, 3, 1, 1).data;
				const [r, g, b] = [data![0]!, data![1]!, data![2]!];
				if (g > 100 && r < 120) return 'green';
				if (b > 150) return 'blue';
				return `unknown(${r},${g},${b})`;
			};
			// Source frame 3 starts the green animation bucket. The encoded file still starts at t=0.
			expect(colorAt(first!)).toBe('green');
			expect(colorAt(later!)).toBe('blue');
		} finally {
			input.dispose?.();
		}
	}, 30_000);
});
