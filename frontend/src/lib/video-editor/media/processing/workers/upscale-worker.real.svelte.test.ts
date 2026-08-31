import { afterEach, describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	Input,
	EncodedPacketSink,
	Output,
	VideoSample,
	VideoSampleSink,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import type { UpscaleWorkerResponse } from './upscale-worker';

const WIDTH = 64;
const HEIGHT = 36;
const FPS = 3;
const WORKER_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = WORKER_TIMEOUT_MS + 10_000;
const scratchJobs: string[] = [];

async function sourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 300_000, keyFrameInterval: 1 });
	const audioSource = new AudioSampleSource({ codec: 'opus', bitrate: 64_000 });
	output.addVideoTrack(source, { frameRate: FPS });
	output.addAudioTrack(audioSource);
	await output.start();
	const sampleRate = 48_000;
	const pcm = new Float32Array(sampleRate);
	for (let index = 0; index < pcm.length; index++) {
		pcm[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.15;
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
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < 3; frame++) {
		context.fillStyle = ['#e23b3b', '#32a852', '#376ee6'][frame]!;
		context.fillRect(0, 0, WIDTH, HEIGHT);
		context.fillStyle = '#ffffff';
		context.fillRect(8 + frame * 4, 8, 16, 12);
		const sample = new VideoSample(canvas, {
			timestamp: frame / FPS,
			duration: 1 / FPS
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

async function scratchFile(jobId: string): Promise<File> {
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle('upscale-tmp');
	return (await dir.getFileHandle(`${jobId}.mp4`)).getFile();
}

afterEach(async () => {
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle('upscale-tmp', { create: true });
	for (const jobId of scratchJobs.splice(0)) {
		await dir.removeEntry(`${jobId}.mp4`).catch(() => undefined);
	}
});

describe('Anime4K upscale worker', () => {
	it(
		'runs the bundled model through the real decode, inference, streamed encode, and decode path',
		async () => {
			const worker = new Worker(new URL('./upscale-worker.ts', import.meta.url), {
				type: 'module'
			});
			const jobId = crypto.randomUUID();
			scratchJobs.push(jobId);
			try {
				const completion = new Promise<Extract<UpscaleWorkerResponse, { type: 'complete' }>>(
					(resolve, reject) => {
						const timeout = window.setTimeout(
							() => reject(new Error('Upscale worker timed out.')),
							WORKER_TIMEOUT_MS
						);
						worker.onmessage = (event: MessageEvent<UpscaleWorkerResponse>) => {
							if (event.data.jobId !== jobId) return;
							if (event.data.type === 'complete') {
								window.clearTimeout(timeout);
								resolve(event.data);
							} else if (event.data.type === 'error') {
								window.clearTimeout(timeout);
								reject(new Error(event.data.error));
							}
						};
						worker.onerror = (event) => reject(new Error(event.message));
					}
				);
				worker.postMessage({
					type: 'upscale',
					jobId,
					source: await sourceVideo(),
					sourceFps: FPS,
					variant: 'liveAction'
				});

				const message = await completion;
				expect(message.result).toMatchObject({
					width: WIDTH * 2,
					height: HEIGHT * 2,
					sourceWidth: WIDTH,
					sourceHeight: HEIGHT,
					frameCount: 3
				});

				const rendered = await scratchFile(jobId);
				expect(rendered.size).toBeGreaterThan(500);
				const input = new Input({ source: new BlobSource(rendered), formats: ALL_FORMATS });
				try {
					const track = await input.getPrimaryVideoTrack();
					expect(track).not.toBeNull();
					expect(await track!.getSquarePixelWidth()).toBe(WIDTH * 2);
					expect(await track!.getSquarePixelHeight()).toBe(HEIGHT * 2);
					let frames = 0;
					for await (const sample of new VideoSampleSink(track!).samples()) {
						frames++;
						sample.close();
					}
					expect(frames).toBe(3);
					const audioTrack = await input.getPrimaryAudioTrack();
					expect(audioTrack).not.toBeNull();
					let audioPackets = 0;
					for await (const packet of new EncodedPacketSink(audioTrack!).packets()) {
						expect(packet.timestamp).toBeGreaterThanOrEqual(0);
						audioPackets++;
					}
					expect(audioPackets).toBeGreaterThan(0);
				} finally {
					input.dispose();
				}
			} finally {
				worker.terminate();
			}
		},
		TEST_TIMEOUT_MS
	);
});
