import { describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	BufferTarget,
	CanvasSource,
	Input,
	Output,
	WebMOutputFormat
} from 'mediabunny';
import { probeSourceFile } from './source';
import { preflightExport, exportSegments, discardScratchFile } from './export';
import { createSegment } from './model';
import { prepareRepurposePreview } from './repurpose-preview';

async function createAvWebM(): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const video = new CanvasSource(canvas, { codec: 'vp9', bitrate: 500_000 });
	const audio = new (await import('mediabunny')).AudioSampleSource({
		codec: 'opus',
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
	return new File([target.buffer], 'av.webm', { type: 'video/webm' });
}

async function createInterleavedMultiTrackWebM(): Promise<File> {
	const canvas0 = document.createElement('canvas');
	canvas0.width = 64;
	canvas0.height = 64;
	const ctx0 = canvas0.getContext('2d')!;
	const canvas1 = document.createElement('canvas');
	canvas1.width = 128;
	canvas1.height = 128;
	const ctx1 = canvas1.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	// Create 2 video tracks and 2 audio tracks interleaved in container order: video0, audio0, video1, audio1
	// This proves array[index] (per-type) is used, not global track.number
	const video0 = new CanvasSource(canvas0, { codec: 'vp9', bitrate: 300_000 });
	const { AudioSampleSource, AudioSample } = await import('mediabunny');
	const audio0 = new AudioSampleSource({ codec: 'opus', bitrate: 64_000 });
	const video1 = new CanvasSource(canvas1, { codec: 'vp9', bitrate: 300_000 });
	const audio1 = new AudioSampleSource({ codec: 'opus', bitrate: 64_000 });
	// Add in interleaved order
	output.addVideoTrack(video0);
	output.addAudioTrack(audio0);
	output.addVideoTrack(video1);
	output.addAudioTrack(audio1);
	await output.start();
	// Feed video frames: each track gets different color/size to distinguish
	for (let i = 0; i < 10; i++) {
		ctx0.fillStyle = 'red';
		ctx0.fillRect(0, 0, 64, 64);
		await video0.add(i / 30, 1 / 30);
		ctx1.fillStyle = 'blue';
		ctx1.fillRect(0, 0, 128, 128);
		await video1.add(i / 30, 1 / 30);
	}
	const sr = 48000;
	const pcm0 = new Float32Array(sr * 0.3);
	for (let i = 0; i < pcm0.length; i++) pcm0[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.3;
	const pcm1 = new Float32Array(sr * 0.3);
	for (let i = 0; i < pcm1.length; i++) pcm1[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
	const s0 = new AudioSample({
		data: pcm0,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate: sr,
		timestamp: 0
	});
	const s1 = new AudioSample({
		data: pcm1,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate: sr,
		timestamp: 0
	});
	await audio0.add(s0);
	await audio1.add(s1);
	s0.close();
	s1.close();
	video0.close();
	video1.close();
	audio0.close();
	audio1.close();
	await output.finalize();
	if (!target.buffer) throw new Error('no buffer');
	return new File([target.buffer], 'multi-interleaved.webm', {
		type: 'video/webm'
	});
}

describe('quick-cut stream selection browser', () => {
	it('video-off selection produces audio-only output', async () => {
		const file = await createAvWebM();
		const src = await probeSourceFile(file);
		expect(src.videoStreams.length).toBeGreaterThan(0);
		expect(src.audioStreams.length).toBeGreaterThan(0);
		// Disable video
		src.selectedVideoTrackIndex = null;
		src.selectedAudioTrackIndices = [0];
		const seg = createSegment(0, 0.25, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(true);
		const [art] = await exportSegments({
			sources: [src],
			segments: [seg],
			cutMode: 'nearestKeyframe',
			merge: false
		});
		expect(art).toBeDefined();
		const input = new Input({
			formats: ALL_FORMATS,
			source: new BlobSource(art!.scratchFile)
		});
		const vTrack = await input.getPrimaryVideoTrack().catch(() => null);
		const aTrack = await input.getPrimaryAudioTrack().catch(() => null);
		expect(vTrack).toBeNull();
		expect(aTrack).not.toBeNull();
		input.dispose?.();
		await discardScratchFile(art!.scratchPath);
	}, 30000);
});

it('Repurpose audition trims exact bounds and plays only the transcript audio track', async () => {
	const file = await createInterleavedMultiTrackWebM();
	const source = await probeSourceFile(file);
	source.selectedAudioTrackIndices = [0, 1];
	const preview = await prepareRepurposePreview(
		source,
		{ start: 0.073, end: 0.237 },
		1,
		new AbortController().signal,
		() => {}
	);
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(await (await fetch(preview.url)).blob())
	});
	try {
		const tracks = await input.getAudioTracks();
		expect(tracks).toHaveLength(1);
		expect(await input.computeDuration()).toBeGreaterThan(0.14);
		expect(await input.computeDuration()).toBeLessThan(0.2);
		const samples: number[] = [];
		let sampleRate = 0;
		for await (const { buffer } of new AudioBufferSink(tracks[0]!).buffers()) {
			sampleRate = buffer.sampleRate;
			samples.push(...buffer.getChannelData(0));
		}
		function toneAmplitude(frequency: number) {
			let sine = 0;
			let cosine = 0;
			for (let index = 0; index < samples.length; index++) {
				const angle = (2 * Math.PI * frequency * index) / sampleRate;
				sine += samples[index]! * Math.sin(angle);
				cosine += samples[index]! * Math.cos(angle);
			}
			return Math.hypot(sine, cosine) / samples.length;
		}
		expect(toneAmplitude(440)).toBeGreaterThan(0.05);
		expect(toneAmplitude(440)).toBeGreaterThan(toneAmplitude(220) * 4);
	} finally {
		input.dispose();
		await preview.dispose();
	}
}, 30_000);
