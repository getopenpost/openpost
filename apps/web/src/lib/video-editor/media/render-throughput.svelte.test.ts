import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny';
import { renderMultiTrackVideoArtifact, TimelineFrameRenderer } from './render-export';
import { ResilientVideoFrameDecoder } from './render-video-decoder';
import { mediaPool } from './pool.svelte';
import type { Project } from '../project/types';
import { ItemRasterizer } from './item-rasterizer';

const FPS = 30;
const FRAME_COUNT = 60;

async function sourceVideo(width = 64, height = 64): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new VideoSampleSource({
		codec: 'avc',
		bitrate: 1_000_000,
		keyFrameInterval: 2
	});
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	for (let frame = 0; frame < FRAME_COUNT; frame++) {
		context.fillStyle = `rgb(${frame * 4}, 40, 80)`;
		context.fillRect(0, 0, width, height);
		// Six high-contrast bits survive lossy encoding and identify every source frame.
		for (let bit = 0; bit < 6; bit++) {
			context.fillStyle = frame & (1 << bit) ? 'white' : 'black';
			context.fillRect(bit * 10, 0, 10, 10);
		}
		const sample = new VideoSample(canvas, {
			timestamp: frame / FPS,
			duration: 1 / FPS
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	return new Blob([target.buffer!], { type: 'video/mp4' });
}

function frameIdentity(canvas: OffscreenCanvas): number {
	const context = canvas.getContext('2d')!;
	let identity = 0;
	for (let bit = 0; bit < 6; bit++) {
		if (context.getImageData(bit * 10 + 5, 5, 1, 1).data[0]! > 128) identity += 2 ** bit;
	}
	return identity;
}

function sourceProject(isReversed = false): Project {
	return {
		id: 'decode-test',
		name: 'Decode test',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 2,
		metadata: { width: 64, height: 64, fps: FPS },
		timeline: {
			tracks: [
				{
					id: 'v',
					name: 'Video',
					order: 0,
					kind: 'video',
					height: 80,
					visible: true,
					locked: false,
					muted: false,
					solo: false
				}
			],
			items: [
				{
					id: 'clip',
					type: 'video',
					trackId: 'v',
					mediaId: 'source',
					from: 0,
					durationInFrames: FRAME_COUNT,
					label: 'Clip',
					sourceFps: FPS,
					sourceWidth: 64,
					sourceHeight: 64,
					isReversed
				}
			]
		}
	};
}

afterEach(() => {
	mediaPool.clear();
	vi.restoreAllMocks();
});

describe('timeline rendering', () => {
	it('bounds retained raster memory after compositing and releases it on disposal', () => {
		const rasterizer = new ItemRasterizer(2048, 2048, FPS);
		const canvases: OffscreenCanvas[] = [];
		try {
			for (let index = 0; index < 4; index++) {
				const result = rasterizer.render(
					{
						id: `shape-${index}`,
						type: 'shape',
						trackId: 'v',
						from: 0,
						durationInFrames: 60,
						label: 'Shape',
						shapeType: 'rectangle',
						fillColor: '#ff0000'
					},
					0
				)!;
				expect(result.source).toBeInstanceOf(OffscreenCanvas);
				if (!(result.source instanceof OffscreenCanvas)) throw new Error('Expected canvas raster');
				canvases.push(result.source);
				expect([...result.source.getContext('2d')!.getImageData(1024, 1024, 1, 1).data]).toEqual([
					255, 0, 0, 255
				]);
				rasterizer.release();
				expect(
					canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0)
				).toBeLessThanOrEqual(32 * 1024 * 1024);
			}
		} finally {
			rasterizer.dispose();
		}
		expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
	});

	it('reuses unchanged caption pixels but paints the next cue at its exact frame', async () => {
		const project = sourceProject();
		project.timeline!.items = [
			{
				id: 'captions',
				type: 'subtitle',
				trackId: 'v',
				from: 0,
				durationInFrames: 60,
				label: 'Captions',
				fontFamily: 'sans-serif',
				fontSize: 16,
				color: '#ffffff',
				cues: [
					{ id: 'one', startFrame: 0, endFrame: 30, text: 'ONE' },
					{ id: 'two', startFrame: 30, endFrame: 60, text: 'TWO' }
				]
			}
		];
		const paint = vi.spyOn(OffscreenCanvasRenderingContext2D.prototype, 'fillText');
		const renderer = new TimelineFrameRenderer(project);
		try {
			const first = (await renderer.render(0)).getContext('2d')!.getImageData(0, 0, 64, 64).data;
			expect(first.some((value, index) => index % 4 === 0 && value > 0)).toBe(true);
			for (let frame = 1; frame < 30; frame++) await renderer.render(frame);
			expect(paint.mock.calls.length).toBeLessThanOrEqual(1);
			const unchanged = renderer.canvas.getContext('2d')!.getImageData(0, 0, 64, 64).data;
			expect(unchanged).toEqual(first);
			const next = (await renderer.render(30)).getContext('2d')!.getImageData(0, 0, 64, 64).data;
			expect(next.some((value, index) => index % 4 === 0 && value > 0)).toBe(true);
			expect(next).not.toEqual(first);
		} finally {
			renderer.dispose();
		}
	});

	it('refreshes text after an already loaded font replaces another face', async () => {
		const mono = await new FontFace(
			'Raster test font',
			'local("Courier New"), local("Liberation Mono"), local("DejaVu Sans Mono")'
		).load();
		const proportional = await new FontFace(
			'Raster test font',
			'local("Arial"), local("Liberation Sans"), local("DejaVu Sans")'
		).load();
		document.fonts.add(mono);
		const project = sourceProject();
		project.metadata.width = 256;
		project.timeline!.items = [
			{
				id: 'title',
				type: 'text',
				trackId: 'v',
				from: 0,
				durationInFrames: 60,
				label: 'Title',
				fontFamily: 'Raster test font',
				fontSize: 24,
				color: '#ffffff',
				text: 'iiiiiiii'
			}
		];
		const renderer = new TimelineFrameRenderer(project);
		const inkWidth = (canvas: OffscreenCanvas) => {
			const pixels = canvas.getContext('2d')!.getImageData(0, 0, 256, 64).data;
			const columns = new Set<number>();
			for (let pixel = 0; pixel < pixels.length; pixel += 4)
				if (pixels[pixel]! > 0) columns.add((pixel / 4) % 256);
			return Math.max(...columns) - Math.min(...columns);
		};
		try {
			const initial = inkWidth(await renderer.render(0));
			document.fonts.delete(mono);
			document.fonts.add(proportional);
			const replaced = inkWidth(await renderer.render(1));
			expect(initial).toBeGreaterThan(80);
			expect(replaced).toBeLessThan(60);
		} finally {
			renderer.dispose();
			document.fonts.delete(mono);
			document.fonts.delete(proportional);
		}
	});

	it('releases the submitted frame when the encoder rejects an export', async () => {
		const project = sourceProject();
		project.timeline!.items = [
			{
				id: 'background',
				type: 'background',
				trackId: 'v',
				from: 0,
				durationInFrames: 1,
				label: 'Background'
			}
		];
		let submitted: VideoSample | undefined;
		vi.spyOn(VideoSampleSource.prototype, 'add').mockImplementation(async (sample) => {
			submitted = sample;
			throw new Error('Encoder failed');
		});
		await expect(renderMultiTrackVideoArtifact(project)).rejects.toThrow('Encoder failed');
		expect(submitted).toBeDefined();
		expect(() => submitted!.toVideoFrame()).toThrow(/closed/i);
	});

	it('keeps simultaneous uses of a source independent and releases inactive decoders', async () => {
		const blob = await sourceVideo();
		const url = URL.createObjectURL(blob);
		mediaPool.upsert(
			{
				id: 'source',
				storageType: 'cloud',
				remoteUrl: url,
				fileName: 'source.mp4',
				fileSize: blob.size,
				mimeType: blob.type,
				duration: 2,
				width: 64,
				height: 64,
				fps: FPS,
				codec: 'avc',
				bitrate: 1_000_000,
				tags: []
			},
			'ready'
		);
		const project = sourceProject();
		const timeline = project.timeline!;
		const first = timeline.items[0]!;
		first.transform = { x: -16, width: 32, height: 64 };
		timeline.tracks.push({ ...timeline.tracks[0]!, id: 'v2', order: 1 });
		timeline.items.push({
			...first,
			id: 'second',
			trackId: 'v2',
			sourceStart: 30,
			durationInFrames: 30,
			transform: { x: 16, width: 32, height: 64 }
		});
		const configure = vi.spyOn(VideoDecoder.prototype, 'configure');
		const close = vi.spyOn(VideoDecoder.prototype, 'close');
		const dispose = vi.spyOn(ResilientVideoFrameDecoder.prototype, 'dispose');
		const fetchSource = vi.spyOn(globalThis, 'fetch');
		const renderer = new TimelineFrameRenderer(project);
		try {
			for (let frame = 0; frame < 30; frame++) {
				const canvas = await renderer.render(frame);
				const context = canvas.getContext('2d')!;
				expect(Math.abs(context.getImageData(16, 32, 1, 1).data[0]! - frame * 4)).toBeLessThan(5);
				expect(
					Math.abs(context.getImageData(48, 32, 1, 1).data[0]! - (frame + 30) * 4)
				).toBeLessThan(5);
			}
			expect(configure.mock.calls.length).toBeLessThanOrEqual(4);
			expect(fetchSource.mock.calls.filter(([request]) => request === url)).toHaveLength(1);
			// Frame 32 is past the second clip's 30-frame range but still inside the
			// first clip. The renderer must release the inactive decoder before its own
			// dispose, while the still-active source keeps rendering real frames.
			const disposesBeforeRelease = dispose.mock.calls.length;
			const closesBeforeRelease = close.mock.calls.length;
			await renderer.render(32);
			await vi.waitFor(() =>
				expect(dispose.mock.calls.length).toBeGreaterThan(disposesBeforeRelease)
			);
			await vi.waitFor(() => expect(close.mock.calls.length).toBeGreaterThan(closesBeforeRelease));
			const activeFrame = (await renderer.render(33)).getContext('2d')!;
			expect(Math.abs(activeFrame.getImageData(8, 32, 1, 1).data[0]! - 33 * 4)).toBeLessThan(5);
			renderer.dispose();
			await vi.waitFor(() => expect(close.mock.calls.length).toBe(configure.mock.calls.length));
		} finally {
			renderer.dispose();
			dispose.mockRestore();
			URL.revokeObjectURL(url);
		}
	});
	it('releases finished nested compositions before the export ends', async () => {
		const blob = await sourceVideo();
		const url = URL.createObjectURL(blob);
		mediaPool.upsert(
			{
				id: 'source',
				storageType: 'cloud',
				remoteUrl: url,
				fileName: 'source.mp4',
				fileSize: blob.size,
				mimeType: blob.type,
				duration: 2,
				width: 64,
				height: 64,
				fps: FPS,
				codec: 'avc',
				bitrate: 1_000_000,
				tags: []
			},
			'ready'
		);
		const project = sourceProject();
		const timeline = project.timeline!;
		const source = timeline.items[0]!;
		timeline.compositions = [
			{
				id: 'nested',
				name: 'Nested recording',
				items: [source],
				tracks: timeline.tracks,
				transitions: [],
				fps: FPS,
				width: 64,
				height: 64,
				durationInFrames: FRAME_COUNT
			}
		];
		timeline.items = [0, 1, 2].map((index) => ({
			id: `nested-${index}`,
			type: 'composition',
			trackId: 'v',
			label: 'Nested recording',
			compositionId: 'nested',
			from: index * 10,
			durationInFrames: 10,
			sourceFps: FPS
		}));
		const configure = vi.spyOn(VideoDecoder.prototype, 'configure');
		const close = vi.spyOn(VideoDecoder.prototype, 'close');
		const renderer = new TimelineFrameRenderer(project);
		try {
			for (let frame = 0; frame < 30; frame++) {
				const canvas = await renderer.render(frame);
				const red = canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data[0]!;
				expect(Math.abs(red - (frame % 10) * 4)).toBeLessThan(5);
			}
			await vi.waitFor(() =>
				expect(configure.mock.calls.length - close.mock.calls.length).toBeLessThanOrEqual(1)
			);
			await renderer.render(30);
			await vi.waitFor(() => expect(close.mock.calls.length).toBe(configure.mock.calls.length));
		} finally {
			renderer.dispose();
			URL.revokeObjectURL(url);
		}
	});
	it.each([
		{ isReversed: false, sourceStep: 1 },
		{ isReversed: true, sourceStep: 2 },
		{ isReversed: true, sourceStep: 1, ramped: true }
	])(
		'reuses decoding and draws requested frames, reversed=$isReversed, source step=$sourceStep, ramped=$ramped',
		async ({ isReversed, sourceStep, ramped }) => {
			const blob = await sourceVideo();
			const url = URL.createObjectURL(blob);
			mediaPool.upsert(
				{
					id: 'source',
					storageType: 'cloud',
					remoteUrl: url,
					fileName: 'source.mp4',
					fileSize: blob.size,
					mimeType: blob.type,
					duration: 2,
					width: 64,
					height: 64,
					fps: FPS,
					codec: 'avc',
					bitrate: 1_000_000,
					tags: []
				},
				'ready'
			);
			const project = sourceProject(isReversed);
			project.metadata.fps = FPS / sourceStep;
			const outputFrames = ramped ? 45 : FRAME_COUNT / sourceStep;
			const clip = project.timeline!.items[0]!;
			clip.durationInFrames = outputFrames;
			if (ramped) {
				clip.sourceEnd = FRAME_COUNT;
				clip.speedRamp = [
					{ id: 'normal', sourceFrame: 0, speed: 1, easing: 'hold' },
					{ id: 'fast', sourceFrame: 15, speed: 2, easing: 'hold' },
					{ id: 'slow', sourceFrame: 45, speed: 1, easing: 'hold' },
					{ id: 'end', sourceFrame: 60, speed: 1, easing: 'linear' }
				];
			}
			const expectedSourceFrame = (frame: number): number => {
				if (ramped) {
					if (frame < 15) return 59 - frame;
					if (frame < 30) return 74 - frame * 2;
					return 44 - frame;
				}
				return isReversed ? FRAME_COUNT - 1 - frame * sourceStep : frame * sourceStep;
			};
			const draw = vi.spyOn(VideoSample.prototype, 'drawWithFit');
			const configure = vi.spyOn(VideoDecoder.prototype, 'configure');
			const renderer = new TimelineFrameRenderer(project);
			try {
				for (let frame = 0; frame < outputFrames; frame++) {
					const canvas = await renderer.render(frame);
					expect(frameIdentity(canvas)).toBe(expectedSourceFrame(frame));
				}
				// A clip must not repeatedly decode its preceding keyframe group during export.
				expect(configure.mock.calls.length).toBeLessThanOrEqual(4);
				expect(draw.mock.calls.length).toBeLessThanOrEqual(outputFrames);
				for (const frame of [8, 9, 9, outputFrames - 1, 2, 3]) {
					const canvas = await renderer.render(frame);
					expect(frameIdentity(canvas)).toBe(expectedSourceFrame(frame));
				}
			} finally {
				renderer.dispose();
				URL.revokeObjectURL(url);
			}
		}
	);
});
