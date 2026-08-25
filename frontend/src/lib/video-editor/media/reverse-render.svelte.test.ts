import { afterEach, describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSink,
	Input,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { renderMultiTrackVideoBlob } from './render-export';
import { mediaPool } from './pool.svelte';
import { setWorkspaceRoot } from '../workspace-fs/root';

const SIZE = 64;
const FPS = 2;
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#facc15'];

async function fourFrameVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 500_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < COLORS.length; frame++) {
		context.fillStyle = COLORS[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, { timestamp: frame / FPS, duration: 1 / FPS });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

async function centerPixel(blob: Blob, seconds: number): Promise<[number, number, number]> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('Rendered output has no video track.');
		const sink = new CanvasSink(track);
		const wrapped = await sink.getCanvas(seconds);
		if (!wrapped) throw new Error(`No decoded frame at ${seconds}.`);
		const context = wrapped.canvas.getContext('2d');
		if (!context) throw new Error('Decoded canvas unavailable.');
		const pixel = context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
		return [pixel[0]!, pixel[1]!, pixel[2]!];
	} finally {
		input.dispose?.();
	}
}

function closeTo(actual: [number, number, number], expected: [number, number, number]): void {
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(actual[channel]! - expected[channel]!)).toBeLessThan(18);
	}
}

afterEach(() => {
	mediaPool.clear();
	setWorkspaceRoot(null);
});

describe('reverse rendered export', () => {
	it('decodes source frames in reverse order through the production codec path', async () => {
		// SAFETY: in-memory test handle implements the workspace root surface used by mediaPool.
		setWorkspaceRoot({ name: 'test' } as FileSystemDirectoryHandle);
		const sourceBlob = await fourFrameVideo();
		const sourceFile = new File([sourceBlob], 'four-frames.webm', { type: sourceBlob.type });
		mediaPool.upsert(
			{
				id: 'source',
				storageType: 'handle',
				// SAFETY: handle stub implements getFile for workspace-backed media in this export test.
				fileHandle: { getFile: async () => sourceFile } as FileSystemFileHandle,
				fileName: sourceFile.name,
				fileSize: sourceFile.size,
				mimeType: sourceFile.type,
				duration: COLORS.length / FPS,
				width: SIZE,
				height: SIZE,
				fps: FPS,
				codec: 'vp8',
				bitrate: 500_000,
				tags: ['video']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 'video',
			name: 'Video',
			kind: 'video',
			height: 96,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'clip',
			trackId: track.id,
			from: 0,
			durationInFrames: COLORS.length,
			label: 'Four frames',
			type: 'video',
			mediaId: 'source',
			sourceStart: 0,
			sourceEnd: COLORS.length,
			sourceDuration: COLORS.length,
			sourceFps: FPS,
			sourceWidth: SIZE,
			sourceHeight: SIZE,
			isReversed: true
		};
		const project: Project = {
			id: 'reverse-test',
			name: 'Reverse test',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: COLORS.length / FPS,
			metadata: { width: SIZE, height: SIZE, fps: FPS, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [item], transitions: [] }
		};

		const reversed = await renderMultiTrackVideoBlob(project, {
			format: 'webm',
			codec: 'vp8',
			quality: 'draft',
			subtitleMode: 'none'
		});

		closeTo(await centerPixel(reversed, 0), [250, 204, 21]);
		closeTo(await centerPixel(reversed, 1.5), [239, 68, 68]);
	});
});
