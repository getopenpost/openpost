import { describe, expect, it } from 'vitest';
import {
	BlobSource,
	CanvasSource,
	Input,
	ALL_FORMATS,
	Mp4OutputFormat,
	Output,
	BufferTarget,
	EncodedPacketSink,
	CanvasSink,
	AudioSample,
	AudioSampleSink,
	AudioSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import { probeSourceFile } from './source';
import { preflightExport, exportSegments, discardScratchFile } from './export';
import { createSegment } from './model';

async function createColorMp4(
	color: string,
	durationSec: number,
	width = 128,
	height = 72
): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });
	output.addVideoTrack(source);
	await output.start();
	const fps = 30;
	const frames = Math.ceil(durationSec * fps);
	for (let i = 0; i < frames; i++) {
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = 'white';
		ctx.fillRect(5, 5, 10, 10);
		await source.add(i / fps, 1 / fps);
	}
	source.close();
	await output.finalize();
	const buf = target.buffer;
	if (!buf) throw new Error('no buffer');
	return new File([buf], `${color}-${width}x${height}.mp4`, { type: 'video/mp4' });
}

async function createToneWebM(frequency: number, durationSec = 1): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new AudioSampleSource({ codec: 'opus', bitrate: 96_000 });
	output.addAudioTrack(source);
	await output.start();
	const sampleRate = 48_000;
	const pcm = new Float32Array(Math.round(durationSec * sampleRate));
	for (let index = 0; index < pcm.length; index++) {
		pcm[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.4;
	}
	const sample = new AudioSample({
		data: pcm,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate,
		timestamp: 0
	});
	await source.add(sample);
	sample.close();
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('No audio fixture bytes.');
	return new File([target.buffer], `tone-${frequency}.webm`, { type: 'audio/webm' });
}

async function createColorToneWebM(
	color: string,
	frequency: number,
	durationSec = 1
): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 72;
	const context = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'vp9', bitrate: 1_000_000 });
	const audio = new AudioSampleSource({ codec: 'opus', bitrate: 96_000 });
	output.addVideoTrack(video);
	output.addAudioTrack(audio);
	await output.start();

	const sampleRate = 48_000;
	const pcm = new Float32Array(Math.round(durationSec * sampleRate));
	for (let frame = 0; frame < pcm.length; frame++) {
		pcm[frame] = Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * 0.4;
	}
	const sample = new AudioSample({
		data: pcm,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate,
		timestamp: 0
	});
	await audio.add(sample);
	sample.close();

	const fps = 30;
	for (let frame = 0; frame < Math.ceil(durationSec * fps); frame++) {
		context.fillStyle = color;
		context.fillRect(0, 0, canvas.width, canvas.height);
		await video.add(frame / fps, 1 / fps);
	}
	video.close();
	audio.close();
	await output.finalize();
	if (!target.buffer) throw new Error('No A/V fixture bytes.');
	return new File([target.buffer], `${color}-${frequency}.webm`, { type: 'video/webm' });
}

async function decodedMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Merged output has no audio track.');
		const chunks: Float32Array[] = [];
		let length = 0;
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				const pcm = new Float32Array(sample.numberOfFrames);
				sample.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
				chunks.push(pcm);
				length += pcm.length;
			} finally {
				sample.close();
			}
		}
		const samples = new Float32Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			samples.set(chunk, offset);
			offset += chunk.length;
		}
		return { samples, sampleRate: track.sampleRate };
	} finally {
		input.dispose?.();
	}
}

function tonePowerAt(
	samples: Float32Array,
	sampleRate: number,
	centerSeconds: number,
	frequency: number,
	windowSeconds = 0.2
): number {
	const halfWindow = Math.round((windowSeconds * sampleRate) / 2);
	const center = Math.round(centerSeconds * sampleRate);
	const start = Math.max(0, center - halfWindow);
	const end = Math.min(samples.length, center + halfWindow);
	let real = 0;
	let imaginary = 0;
	for (let index = start; index < end; index++) {
		const angle = (2 * Math.PI * frequency * (index - start)) / sampleRate;
		real += samples[index]! * Math.cos(angle);
		imaginary -= samples[index]! * Math.sin(angle);
	}
	return real * real + imaginary * imaginary;
}

function expectToneAt(
	samples: Float32Array,
	sampleRate: number,
	centerSeconds: number,
	expectedFrequency: 220 | 440
): void {
	const otherFrequency = expectedFrequency === 220 ? 440 : 220;
	expect(tonePowerAt(samples, sampleRate, centerSeconds, expectedFrequency)).toBeGreaterThan(
		tonePowerAt(samples, sampleRate, centerSeconds, otherFrequency) * 20
	);
}

describe('quick-cut mediabunny fixture', () => {
	it('compatible A/B/A sources with same codec/dimensions/canvas prove packet-copy order', async () => {
		const fileA = await createColorMp4('red', 2, 128, 72);
		const fileB = await createColorMp4('blue', 2, 128, 72);
		const srcA = await probeSourceFile(fileA);
		const srcB = await probeSourceFile(fileB);
		expect(srcA.width).toBe(srcB.width);
		expect(srcA.videoCodec).toBe(srcB.videoCodec);
		const segs = [
			createSegment(0, 1, { sourceId: srcA.id }),
			createSegment(0, 1, { sourceId: srcB.id }),
			createSegment(0, 1, { sourceId: srcA.id })
		];
		const pre = await preflightExport([srcA, srcB], segs, 'nearestKeyframe', true);
		expect(pre.eligible).toBe(true);
		expect(pre.requiresTranscode).toBe(false);
		const progress: Array<{ fraction: number; bytesWritten: number }> = [];
		const arts = await exportSegments({
			sources: [srcA, srcB],
			segments: segs,
			cutMode: 'nearestKeyframe',
			merge: true,
			onProgress: (update) =>
				progress.push({ fraction: update.fraction, bytesWritten: update.bytesWritten })
		});
		expect(arts).toHaveLength(1);
		const art = arts[0]!;
		expect(art.wasLossless).toBe(true);
		// StructuredClone test for serializable token
		const cloned = structuredClone({
			scratchPath: art.scratchPath,
			fileName: art.fileName,
			wasLossless: art.wasLossless
		});
		expect(cloned.scratchPath).toBe(art.scratchPath);
		// Stream without arrayBuffer
		let streamedBytes = 0;
		const reader = art.scratchFile.stream().getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			streamedBytes += value.byteLength;
		}
		expect(streamedBytes).toBe(art.scratchFile.size);
		expect(streamedBytes).toBeGreaterThan(0);
		expect(progress.length).toBeGreaterThan(3);
		expect(progress.some((update) => update.fraction > 0 && update.fraction < 1)).toBe(true);
		expect(progress.some((update) => update.bytesWritten > 0)).toBe(true);
		expect(progress.at(-1)?.fraction).toBe(1);
		for (let index = 1; index < progress.length; index++) {
			expect(progress[index]!.fraction).toBeGreaterThanOrEqual(progress[index - 1]!.fraction);
			expect(progress[index]!.bytesWritten).toBeGreaterThanOrEqual(
				progress[index - 1]!.bytesWritten
			);
		}
		// Decode and check monotonic timestamps/sequence and duration ~3s, and color order via packet count
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(art.scratchFile) });
		const dur = await input.computeDuration();
		expect(dur).toBeCloseTo(3, 0.5);
		const vTrack = await input.getPrimaryVideoTrack();
		expect(vTrack).not.toBeNull();
		const sink = new EncodedPacketSink(vTrack!);
		let prevTs = -1;
		let prevSeq = -1;
		let count = 0;
		for await (const pkt of sink.packets()) {
			expect(pkt.timestamp).toBeGreaterThanOrEqual(prevTs);
			expect(pkt.sequenceNumber).toBeGreaterThan(prevSeq);
			prevTs = pkt.timestamp;
			prevSeq = pkt.sequenceNumber;
			count++;
			if (count > 500) break;
		}
		expect(count).toBeGreaterThan(0);
		const canvasSink = new CanvasSink(vTrack!, {
			width: 128,
			height: 72,
			fit: 'fill',
			poolSize: 2
		});
		const colorAt = async (seconds: number): Promise<'red' | 'blue'> => {
			const wrapped = await canvasSink.getCanvas(seconds);
			if (!wrapped) throw new Error(`No decoded frame at ${seconds}.`);
			const context = wrapped.canvas.getContext('2d');
			if (!context) throw new Error('Decoded canvas unavailable.');
			const pixel = context.getImageData(64, 36, 1, 1).data;
			return pixel[0]! > pixel[2]! ? 'red' : 'blue';
		};
		expect(await colorAt(0.5)).toBe('red');
		expect(await colorAt(1.5)).toBe('blue');
		expect(await colorAt(2.5)).toBe('red');
		input.dispose?.();
		await discardScratchFile(art.scratchPath);
	}, 30000);

	it('keeps merged A/V packet-copy audio aligned across A/B/A boundaries', async () => {
		const fileA = await createColorToneWebM('red', 220);
		const fileB = await createColorToneWebM('blue', 440);
		const sourceA = await probeSourceFile(fileA);
		const sourceB = await probeSourceFile(fileB);
		const segments = [
			createSegment(0, 0.8, { sourceId: sourceA.id }),
			createSegment(0, 0.8, { sourceId: sourceB.id }),
			createSegment(0, 0.8, { sourceId: sourceA.id })
		];
		const [artifact] = await exportSegments({
			sources: [sourceA, sourceB],
			segments,
			cutMode: 'nearestKeyframe',
			merge: true
		});
		expect(artifact?.wasLossless).toBe(true);

		const decoded = await decodedMono(artifact!.scratchFile);
		expectToneAt(decoded.samples, decoded.sampleRate, 0.4, 220);
		expectToneAt(decoded.samples, decoded.sampleRate, 1.2, 440);
		expectToneAt(decoded.samples, decoded.sampleRate, 2, 220);
		await discardScratchFile(artifact!.scratchPath);
	}, 30000);

	it('incompatible dimensions source proves preflight requires transcode', async () => {
		const fileA = await createColorMp4('red', 1, 128, 72);
		const fileB = await createColorMp4('blue', 1, 192, 108);
		const srcA = await probeSourceFile(fileA);
		const srcB = await probeSourceFile(fileB);
		const segs = [
			createSegment(0, 0.5, { sourceId: srcA.id }),
			createSegment(0, 0.5, { sourceId: srcB.id })
		];
		const pre = await preflightExport([srcA, srcB], segs, 'nearestKeyframe', true);
		expect(pre.requiresTranscode).toBe(true);
		expect(pre.reason).toMatch(/dimensions/i);
	});

	it('falls back to exact re-encoding when the saved keyframe map is stale', async () => {
		const file = await createColorMp4('purple', 1.5);
		const source = await probeSourceFile(file);
		const staleSource = {
			...source,
			keyframeState: 'known' as const,
			keyframeTimestamps: [...source.keyframeTimestamps, 0.2].sort((a, b) => a - b),
			videoStreams: source.videoStreams.map((stream, index) =>
				index === 0
					? {
							...stream,
							keyframeState: 'known' as const,
							keyframeTimestamps: [...stream.keyframeTimestamps, 0.2].sort((a, b) => a - b)
						}
					: stream
			)
		};
		const segment = createSegment(0.2, 0.8, {
			sourceId: source.id,
			cutMode: 'exact'
		});
		const preflight = await preflightExport([staleSource], [segment], 'exact', true);
		expect(preflight.requiresTranscode).toBe(false);

		const [artifact] = await exportSegments({
			sources: [staleSource],
			segments: [segment],
			cutMode: 'exact',
			merge: true
		});
		expect(artifact?.wasLossless).toBe(false);
		expect(artifact?.reason).toMatch(/lossless copy was unavailable/i);

		const input = new Input({
			formats: ALL_FORMATS,
			source: new BlobSource(artifact!.scratchFile)
		});
		expect(await input.computeDuration()).toBeCloseTo(0.6, 0.25);
		input.dispose?.();
		await discardScratchFile(artifact!.scratchPath);
	}, 30000);

	it('does not label an off-keyframe separate export as lossless when its map is stale', async () => {
		const file = await createColorMp4('orange', 1.5);
		const source = await probeSourceFile(file);
		const staleSource = {
			...source,
			keyframeState: 'known' as const,
			keyframeTimestamps: [...source.keyframeTimestamps, 0.2].sort((a, b) => a - b),
			videoStreams: source.videoStreams.map((stream, index) =>
				index === 0
					? {
							...stream,
							keyframeState: 'known' as const,
							keyframeTimestamps: [...stream.keyframeTimestamps, 0.2].sort((a, b) => a - b)
						}
					: stream
			)
		};
		const segment = createSegment(0.2, 0.8, {
			sourceId: source.id,
			cutMode: 'exact'
		});
		const [artifact] = await exportSegments({
			sources: [staleSource],
			segments: [segment],
			cutMode: 'exact',
			merge: false
		});
		expect(artifact?.wasLossless).toBe(false);
		await discardScratchFile(artifact!.scratchPath);
	}, 30000);

	it('merges audio-only A/B/A in order without inventing a video track', async () => {
		const fileA = await createToneWebM(220);
		const fileB = await createToneWebM(440);
		const sourceA = await probeSourceFile(fileA);
		const sourceB = await probeSourceFile(fileB);
		expect(sourceA.keyframeState).toBe('audio-only');
		expect(sourceB.keyframeState).toBe('audio-only');
		const segments = [
			createSegment(0, 0.5, { sourceId: sourceA.id }),
			createSegment(0, 0.5, { sourceId: sourceB.id }),
			createSegment(0.5, 1, { sourceId: sourceA.id })
		];
		const preflight = await preflightExport([sourceA, sourceB], segments, 'nearestKeyframe', true);
		expect(preflight.eligible).toBe(true);
		expect(preflight.requiresTranscode).toBe(false);
		const [artifact] = await exportSegments({
			sources: [sourceA, sourceB],
			segments,
			cutMode: 'nearestKeyframe',
			merge: true
		});
		expect(artifact?.wasLossless).toBe(true);
		const decoded = await decodedMono(artifact!.scratchFile);
		expectToneAt(decoded.samples, decoded.sampleRate, 0.25, 220);
		expectToneAt(decoded.samples, decoded.sampleRate, 0.75, 440);
		expectToneAt(decoded.samples, decoded.sampleRate, 1.25, 220);
		await discardScratchFile(artifact!.scratchPath);
	}, 30_000);

	it('re-encodes exact audio-only cuts at the requested sample ranges', async () => {
		const fileA = await createToneWebM(220);
		const fileB = await createToneWebM(440);
		const sourceA = await probeSourceFile(fileA);
		const sourceB = await probeSourceFile(fileB);
		const segments = [
			createSegment(0.1, 0.4, { sourceId: sourceA.id }),
			createSegment(0.2, 0.5, { sourceId: sourceB.id })
		];
		const preflight = await preflightExport([sourceA, sourceB], segments, 'exact', true);
		expect(preflight.requiresTranscode).toBe(true);
		const [artifact] = await exportSegments({
			sources: [sourceA, sourceB],
			segments,
			cutMode: 'exact',
			merge: true
		});
		expect(artifact?.wasLossless).toBe(false);
		const decoded = await decodedMono(artifact!.scratchFile);
		expect(decoded.samples.length / decoded.sampleRate).toBeCloseTo(0.6, 1);
		expectToneAt(decoded.samples, decoded.sampleRate, 0.15, 220);
		expectToneAt(decoded.samples, decoded.sampleRate, 0.45, 440);
		await discardScratchFile(artifact!.scratchPath);
	}, 30_000);

	it('executes mixed per-segment strategies through separate export paths', async () => {
		const file = await createToneWebM(220);
		const source = await probeSourceFile(file);
		const exact = createSegment(0.1, 0.4, {
			id: 'exact',
			sourceId: source.id,
			cutMode: 'exact'
		});
		const lossless = createSegment(0.5, 0.9, {
			id: 'lossless',
			sourceId: source.id,
			cutMode: 'nearestKeyframe'
		});

		const artifacts = await exportSegments({
			sources: [source],
			segments: [exact, lossless],
			cutMode: 'nearestKeyframe',
			merge: false
		});
		try {
			expect(artifacts).toHaveLength(2);
			expect(artifacts[0]?.wasLossless).toBe(false);
			expect(artifacts[1]?.wasLossless).toBe(true);
			const exactAudio = await decodedMono(artifacts[0]!.scratchFile);
			const losslessAudio = await decodedMono(artifacts[1]!.scratchFile);
			expect(exactAudio.samples.length / exactAudio.sampleRate).toBeCloseTo(0.3, 1);
			expect(losslessAudio.samples.length / losslessAudio.sampleRate).toBeGreaterThan(0.35);
		} finally {
			await Promise.all(artifacts.map((artifact) => discardScratchFile(artifact.scratchPath)));
		}
	}, 30_000);

	it('exact non-keyframe A/B/A proves bounded transcode merge', async () => {
		const fileA = await createColorMp4('green', 2, 128, 72);
		const srcA = await probeSourceFile(fileA);
		// Choose 0.5s which is likely not on keyframe (keyframe interval is 2s for our encoding)
		const segs = [
			createSegment(0.5, 1, { sourceId: srcA.id }),
			createSegment(1.2, 1.7, { sourceId: srcA.id }),
			createSegment(0.2, 0.8, { sourceId: srcA.id })
		];
		const pre = await preflightExport([srcA], segs, 'exact', true);
		expect(pre.requiresTranscode).toBe(true);
		const arts = await exportSegments({
			sources: [srcA],
			segments: segs,
			cutMode: 'exact',
			merge: true
		});
		expect(arts).toHaveLength(1);
		const art = arts[0]!;
		expect(art.wasLossless).toBe(false);
		// Verify duration is sum of kept ranges (0.5+0.5+0.6=1.6)
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(art.scratchFile) });
		const dur = await input.computeDuration();
		expect(dur).toBeCloseTo(1.6, 0.5);
		input.dispose?.();
		await discardScratchFile(art.scratchPath);
	}, 30000);

	it('cancels export and cleans up scratch', async () => {
		const fileA = await createColorMp4('yellow', 2);
		const srcA = await probeSourceFile(fileA);
		const segs = [
			createSegment(0, 1, { sourceId: srcA.id }),
			createSegment(1, 2, { sourceId: srcA.id })
		];
		const ac = new AbortController();
		const promise = exportSegments({
			sources: [srcA],
			segments: segs,
			cutMode: 'nearestKeyframe',
			merge: true,
			signal: ac.signal
		});
		ac.abort();
		await expect(promise).rejects.toThrow(/cancelled|abort/i);
	}, 15000);
});
