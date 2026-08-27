import { describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSource,
	Input,
	Mp4OutputFormat,
	Output
} from 'mediabunny';
import { probeSourceFile } from './source';
import { preflightExport, exportSegments, discardScratchFile } from './export';
import { createSegment } from './model';

async function createAvMp4(): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 500_000 });
	const audio = new (await import('mediabunny')).AudioSampleSource({
		codec: 'aac',
		bitrate: 64_000
	});
	output.addVideoTrack(video);
	output.addAudioTrack(audio);
	await output.start();
	for (let i = 0; i < 15; i++) {
		ctx.fillStyle = i % 2 === 0 ? 'red' : 'blue';
		ctx.fillRect(0, 0, 64, 64);
		await video.add(i / 30, 1 / 30);
	}
	const { AudioSample } = await import('mediabunny');
	const sr = 48000;
	const pcm = new Float32Array(sr * 0.5);
	for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.2;
	const sample = new AudioSample({
		data: pcm,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate: sr,
		timestamp: 0
	});
	await audio.add(sample);
	sample.close();
	video.close();
	audio.close();
	await output.finalize();
	if (!target.buffer) throw new Error('no buffer');
	return new File([target.buffer], 'av.mp4', { type: 'video/mp4' });
}

describe('quick-cut stream selection browser', () => {
	it('video-off selection produces audio-only output', async () => {
		const file = await createAvMp4();
		const src = await probeSourceFile(file);
		expect(src.videoStreams.length).toBeGreaterThan(0);
		expect(src.audioStreams.length).toBeGreaterThan(0);
		// Disable video
		src.selectedVideoTrackIndex = null;
		src.selectedAudioTrackIndices = [0];
		const seg = createSegment(0, 0.4, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(true);
		const [art] = await exportSegments({
			sources: [src],
			segments: [seg],
			cutMode: 'nearestKeyframe',
			merge: false
		});
		expect(art).toBeDefined();
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(art!.scratchFile) });
		const vTrack = await input.getPrimaryVideoTrack().catch(() => null);
		const aTrack = await input.getPrimaryAudioTrack().catch(() => null);
		expect(vTrack).toBeNull();
		expect(aTrack).not.toBeNull();
		input.dispose?.();
		await discardScratchFile(art!.scratchPath);
	}, 30000);

	it('audio-off selection produces video-only output', async () => {
		const file = await createAvMp4();
		const src = await probeSourceFile(file);
		src.selectedVideoTrackIndex = 0;
		src.selectedAudioTrackIndices = [];
		const seg = createSegment(0, 0.4, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(true);
		const [art] = await exportSegments({
			sources: [src],
			segments: [seg],
			cutMode: 'nearestKeyframe',
			merge: false
		});
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(art!.scratchFile) });
		const vTrack = await input.getPrimaryVideoTrack().catch(() => null);
		const aTrack = await input.getPrimaryAudioTrack().catch(() => null);
		expect(vTrack).not.toBeNull();
		expect(aTrack).toBeNull();
		input.dispose?.();
		await discardScratchFile(art!.scratchPath);
	}, 30000);
});
