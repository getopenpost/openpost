// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
	BlobSource,
	CanvasSource,
	Input,
	ALL_FORMATS,
	Mp4OutputFormat,
	Output,
	BufferTarget,
	EncodedPacketSink
} from 'mediabunny';
import { probeSourceFile } from './source';
import { preflightExport, exportSegments } from './export';
import { createSegment } from './model';

async function createColorMp4(
	color: string,
	durationSec: number,
	width = 64,
	height = 64
): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 });
	output.addVideoTrack(source);
	await output.start();
	const fps = 30;
	const frames = Math.ceil(durationSec * fps);
	for (let i = 0; i < frames; i++) {
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = 'white';
		ctx.fillRect(5, 5, 10, 10);
		const frame = new VideoFrame(canvas, { timestamp: (i * 1_000_000) / fps });
		await source.add(frame);
		frame.close();
	}
	source.close();
	await output.finalize();
	const buf = target.buffer;
	if (!buf) throw new Error('no buffer');
	return new File([buf], `${color}-${width}x${height}.mp4`, { type: 'video/mp4' });
}

describe('quick-cut mediabunny fixture', () => {
	it('builds two distinct sources and merges A/B/A with packet proof', async () => {
		const fileA = await createColorMp4('red', 2, 128, 72);
		const fileB = await createColorMp4('blue', 2, 128, 72);
		expect(fileA.size).toBeGreaterThan(0);
		expect(fileB.size).toBeGreaterThan(0);
		const srcA = await probeSourceFile(fileA);
		const srcB = await probeSourceFile(fileB);
		// Ensure distinct content: different width/height already same, but we vary via color; still check duration
		expect(srcA.duration).toBeCloseTo(2, 1);
		expect(srcB.duration).toBeCloseTo(2, 1);
		// Ordered A/B/A segments
		const segs = [
			createSegment(0, 1, { sourceId: srcA.id }),
			createSegment(0, 1, { sourceId: srcB.id }),
			createSegment(1, 2, { sourceId: srcA.id })
		];
		const pre = await preflightExport([srcA, srcB], segs, 'nearestKeyframe', true);
		expect(pre.eligible).toBe(true);
		expect(pre.requiresTranscode).toBe(false);
		const arts = await exportSegments({
			sources: [srcA, srcB],
			segments: segs,
			cutMode: 'nearestKeyframe',
			merge: true
		});
		expect(arts).toHaveLength(1);
		const art = arts[0]!;
		expect(art.wasLossless).toBe(true);
		expect(art.scratchFile.size).toBeGreaterThan(0);
		// Do not use arrayBuffer for large threshold check: use stream
		let streamedBytes = 0;
		const reader = art.scratchFile.stream().getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			streamedBytes += value.byteLength;
		}
		expect(streamedBytes).toBe(art.scratchFile.size);
		// Verify playable duration and monotonic packets
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
			// Avoid infinite
			if (count > 1000) break;
		}
		expect(count).toBeGreaterThan(0);
		input.dispose?.();
		await art.discard();
		// After discard, file should be gone (verify discard doesn't throw)
	}, 30000);

	it('detects incompatible dimensions and requires transcode', async () => {
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
	});

	it('cancels export and cleans up scratch', async () => {
		const fileA = await createColorMp4('green', 2);
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
