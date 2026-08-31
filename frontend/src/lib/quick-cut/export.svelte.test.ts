import { afterEach, describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSink,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	CanvasSink,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import { discardScratchFile, exportSegments } from './export';
import { createSegment } from './model';
import { probeSourceFile } from './source';

const SIZE = 48;
const FPS = 4;
const COLORS = [
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#06b6d4',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899'
];
const scratchPaths: string[] = [];

async function sourceVideo(
	container: 'webm' | 'mp4' = 'webm',
	audio: 'included' | 'omitted' = 'included'
): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({
		format: container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
		target
	});
	const video = new VideoSampleSource({
		codec: container === 'webm' ? 'vp8' : 'avc',
		bitrate: 500_000,
		keyFrameInterval: 1
	});
	const audioSource =
		audio === 'included'
			? new AudioSampleSource({
					codec: container === 'webm' ? 'opus' : 'aac',
					bitrate: 96_000
				})
			: null;
	output.addVideoTrack(video, { frameRate: FPS });
	if (audioSource) output.addAudioTrack(audioSource);
	await output.start();
	if (audioSource) {
		const sampleRate = 48_000;
		const pcm = new Float32Array(2 * sampleRate);
		for (let frame = 0; frame < pcm.length; frame++) {
			pcm[frame] = Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.25;
		}
		const audioSample = new AudioSample({
			data: pcm,
			format: 'f32',
			numberOfChannels: 1,
			sampleRate,
			timestamp: 0
		});
		await audioSource.add(audioSample);
		audioSample.close();
		audioSource.close();
	}
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < COLORS.length; frame++) {
		context.fillStyle = COLORS[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, { timestamp: frame / FPS, duration: 1 / FPS });
		await video.add(sample);
		sample.close();
	}
	video.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new File([target.buffer], `smart-cut-source.${container}`, {
		type: container === 'webm' ? 'video/webm' : 'video/mp4'
	});
}

async function decodedAudioDuration(blob: Blob): Promise<number> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Audio track missing.');
		let end = 0;
		for await (const sample of new AudioSampleSink(track).samples()) {
			end = Math.max(end, sample.timestamp + sample.duration);
			sample.close();
		}
		return end;
	} finally {
		input.dispose();
	}
}

async function packetDigests(
	blob: Blob,
	from: number,
	to = Number.POSITIVE_INFINITY
): Promise<string[]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('Video track missing.');
		const digests: string[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			if (packet.timestamp + 0.001 < from || packet.timestamp >= to - 0.001) continue;
			const digest = await crypto.subtle.digest('SHA-256', packet.data);
			digests.push(
				Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
			);
		}
		return digests;
	} finally {
		input.dispose();
	}
}

async function centerPixel(blob: Blob, timestamp: number): Promise<[number, number, number]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('Video track missing.');
		const wrapped = await new CanvasSink(track).getCanvas(timestamp);
		if (!wrapped) throw new Error('Decoded frame missing.');
		const context = wrapped.canvas.getContext('2d');
		if (!context) throw new Error('2D canvas unavailable.');
		const pixel = context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
		return [pixel[0]!, pixel[1]!, pixel[2]!];
	} finally {
		input.dispose();
	}
}

function expectOrange(actual: [number, number, number]): void {
	expect(actual[0]).toBeGreaterThan(220);
	expect(actual[1]).toBeGreaterThan(70);
	expect(actual[1]).toBeLessThan(150);
	expect(actual[2]).toBeLessThan(70);
}

afterEach(async () => {
	await Promise.all(scratchPaths.splice(0).map((path) => discardScratchFile(path)));
});

describe('Quick Cut smart export', () => {
	it('re-encodes only the leading GOP for an exact off-keyframe cut', async () => {
		const file = await sourceVideo();
		const source = await probeSourceFile(file);
		const segment = createSegment(0.25, 1.75, {
			id: 'exact-boundary',
			sourceId: source.id,
			cutMode: 'exact'
		});
		const sourceTailDigests = await packetDigests(file, 1, 1.75);

		const [artifact] = await exportSegments({
			sources: [source],
			segments: [segment],
			cutMode: 'nearestKeyframe',
			merge: false
		});
		if (!artifact) throw new Error('Export produced no artifact.');
		scratchPaths.push(artifact.scratchPath);

		expect(artifact.wasLossless).toBe(false);
		expect(artifact.reason).toMatch(/leading boundary.*stream-copied/iu);
		expectOrange(await centerPixel(artifact.scratchFile, 0));
		expect(await packetDigests(artifact.scratchFile, 0.75, 1.5)).toEqual(sourceTailDigests);
		expect(await decodedAudioDuration(artifact.scratchFile)).toBeCloseTo(1.5, 1);
	});

	it('keeps AVC tail packets byte-identical in an MP4 smart cut', async () => {
		const file = await sourceVideo('mp4', 'omitted');
		const source = await probeSourceFile(file);
		const segment = createSegment(0.25, 1.75, {
			id: 'avc-boundary',
			sourceId: source.id,
			cutMode: 'exact'
		});
		const sourceTailDigests = await packetDigests(file, 1, 1.75);

		const [artifact] = await exportSegments({
			sources: [source],
			segments: [segment],
			cutMode: 'exact',
			merge: false
		});
		if (!artifact) throw new Error('Export produced no artifact.');
		scratchPaths.push(artifact.scratchPath);

		expect(artifact.reason).toMatch(/leading boundary.*stream-copied/iu);
		expect(await packetDigests(artifact.scratchFile, 0.75, 1.5)).toEqual(sourceTailDigests);
		expectOrange(await centerPixel(artifact.scratchFile, 0));
	});

	it('stream-concatenates compatible smart-cut segments when merging', async () => {
		const file = await sourceVideo();
		const source = await probeSourceFile(file);
		const segments = [
			createSegment(0.25, 1.25, {
				id: 'smart-first',
				sourceId: source.id,
				cutMode: 'exact'
			}),
			createSegment(0, 0.75, {
				id: 'copied-second',
				sourceId: source.id,
				cutMode: 'exact'
			})
		];
		const sourceTailDigests = await packetDigests(file, 1, 1.25);

		const [artifact] = await exportSegments({
			sources: [source],
			segments,
			cutMode: 'exact',
			merge: true
		});
		if (!artifact) throw new Error('Export produced no artifact.');
		scratchPaths.push(artifact.scratchPath);

		expect(artifact.reason).toMatch(/merged with smart cut/iu);
		expect(await packetDigests(artifact.scratchFile, 0.75, 1)).toEqual(sourceTailDigests);
		expectOrange(await centerPixel(artifact.scratchFile, 0));
		expect(await decodedAudioDuration(artifact.scratchFile)).toBeCloseTo(1.75, 1);
	});
});
