import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSink,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource
} from 'mediabunny';
import { TimelineFrameRenderer } from './render-export';
import { mediaPool } from './pool.svelte';
import type { Project } from '../project/types';
import { getProxy, clearProxyCache } from './proxy-client';

const FPS = 30;
const FRAME_COUNT = 60;

async function sourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'avc', bitrate: 1_000_000, keyFrameInterval: 2 });
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(64, 64);
	const context = canvas.getContext('2d')!;
	for (let frame = 0; frame < FRAME_COUNT; frame++) {
		context.fillStyle = `rgb(${frame * 4}, 40, 80)`;
		context.fillRect(0, 0, 64, 64);
		const sample = new VideoSample(canvas, { timestamp: frame / FPS, duration: 1 / FPS });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	return new Blob([target.buffer!], { type: 'video/mp4' });
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

describe('timeline video decoding', () => {
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
			await renderer.render(32);
			renderer.dispose();
			await vi.waitFor(() => expect(close.mock.calls.length).toBe(configure.mock.calls.length));
		} finally {
			renderer.dispose();
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
	it('prepares proxies with frequent seek points while preserving source frames and timing', async () => {
		const blob = await sourceVideo();
		const url = URL.createObjectURL(blob);
		const media = {
			id: 'proxy-source',
			storageType: 'cloud' as const,
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
		};
		let input: Input | undefined;
		try {
			input = new Input({ source: new BlobSource(await getProxy(media)), formats: ALL_FORMATS });
			const track = (await input.getPrimaryVideoTrack())!;
			const packets = new EncodedPacketSink(track);
			expect((await packets.getKeyPacket(1.5))!.timestamp).toBeGreaterThanOrEqual(1.2);
			expect(Math.abs((await track.computeDuration()) - 2)).toBeLessThan(1 / FPS + 0.001);
			let count = 0;
			for await (const frame of new CanvasSink(track, { poolSize: 1 }).canvases()) {
				const red = frame.canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data[0]!;
				expect(Math.abs(red - count * 4)).toBeLessThan(8);
				expect(frame.timestamp).toBeCloseTo(count / FPS, 3);
				count++;
			}
			expect(count).toBe(FRAME_COUNT);
		} finally {
			input?.dispose();
			clearProxyCache(media.id);
			URL.revokeObjectURL(url);
		}
	});
	it.each([false, true])(
		'reuses decoding while keeping frame accuracy, reversed=%s',
		async (isReversed) => {
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
			const configure = vi.spyOn(VideoDecoder.prototype, 'configure');
			const renderer = new TimelineFrameRenderer(project);
			try {
				for (let frame = 0; frame < FRAME_COUNT; frame++) {
					const canvas = await renderer.render(frame);
					const red = canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data[0]!;
					expect(Math.abs(red - (isReversed ? FRAME_COUNT - 1 - frame : frame) * 4)).toBeLessThan(
						5
					);
				}
				// A clip must not repeatedly decode its preceding keyframe group during export.
				expect(configure.mock.calls.length).toBeLessThanOrEqual(4);
				for (const frame of [8, 9, 9, 45, 2, 3]) {
					const canvas = await renderer.render(frame);
					const red = canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data[0]!;
					expect(Math.abs(red - (isReversed ? FRAME_COUNT - 1 - frame : frame) * 4)).toBeLessThan(
						5
					);
				}
			} finally {
				renderer.dispose();
				URL.revokeObjectURL(url);
			}
		}
	);
});
