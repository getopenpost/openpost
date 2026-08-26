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
		const arts = await exportSegments({
			sources: [srcA, srcB],
			segments: segs,
			cutMode: 'nearestKeyframe',
			merge: true
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
		input.dispose?.();
		await discardScratchFile(art.scratchPath);
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
