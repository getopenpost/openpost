/**
 * Proxy generation worker: decodes a video at reduced resolution and
 * re-encodes it as low-bitrate WebM VP9 for smooth scrubbing of large
 * footage. Mirrors waveform-worker's request/response shape.
 */

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
import { PROXY_BITRATE, PROXY_MAX_HEIGHT, proxyDimensions } from './proxy-client';
import { ensureProResDecoderForCodec } from './prores-decoder';

export interface ProxyRequest {
	file: Blob;
	maxHeight?: number;
}

export type ProxyWorkerResponse =
	| { type: 'progress'; progress: number }
	| { type: 'complete'; blob: Blob }
	| { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<ProxyRequest>): Promise<void> => {
	const maxHeight = event.data.maxHeight ?? PROXY_MAX_HEIGHT;
	try {
		const input = new Input({ source: new BlobSource(event.data.file), formats: ALL_FORMATS });
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('No video track found');
		await ensureProResDecoderForCodec(track.codec);
		const duration = await track.computeDuration();
		const size = proxyDimensions(track.displayWidth, track.displayHeight, maxHeight);
		const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: 'fill' });

		const target = new BufferTarget();
		const output = new Output({ format: new WebMOutputFormat(), target });
		const source = new VideoSampleSource({
			codec: 'vp9',
			bitrate: PROXY_BITRATE,
			keyFrameInterval: 2,
			latencyMode: 'quality'
		});
		output.addVideoTrack(source);
		await output.start();

		let lastReported = 0;
		for await (const wrapped of sink.canvases()) {
			const sample = new VideoSample(wrapped.canvas, {
				timestamp: wrapped.timestamp,
				duration: wrapped.duration
			});
			await source.add(sample);
			sample.close();

			const progress = duration > 0 ? Math.min(wrapped.timestamp / duration, 1) : 0;
			if (progress - lastReported >= 0.01 || progress === 1) {
				lastReported = progress;
				self.postMessage({ type: 'progress', progress } satisfies ProxyWorkerResponse);
			}
		}

		source.close();
		await output.finalize();
		if (!target.buffer) throw new Error('Proxy encoding produced no data.');
		self.postMessage({
			type: 'complete',
			blob: new Blob([target.buffer], { type: 'video/webm' })
		} satisfies ProxyWorkerResponse);
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		} satisfies ProxyWorkerResponse);
	}
};
