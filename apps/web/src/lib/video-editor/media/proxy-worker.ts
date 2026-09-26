/**
 * Proxy generation worker: decodes a video at reduced resolution and
 * re-encodes it with frequent keyframes for smooth scrubbing of large
 * footage. Mirrors waveform-worker's request/response shape.
 */

import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSink,
	canEncodeVideo,
	getFirstEncodableVideoCodec,
	Input,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import { PROXY_BITRATE, PROXY_MAX_HEIGHT, proxyDimensions } from './proxy-client';
import { ensureProResDecoderForCodec } from './prores-decoder';

const AVC_PROXY_BITRATE = 4_000_000;
const PROXY_KEYFRAME_SECONDS = 0.25;

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
	let input: Input | undefined;
	let output: Output | undefined;
	try {
		input = new Input({ source: new BlobSource(event.data.file), formats: ALL_FORMATS });
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('No video track found');
		await ensureProResDecoderForCodec(track.codec);
		const duration = await track.computeDuration();
		const size = proxyDimensions(track.displayWidth, track.displayHeight, maxHeight);
		const sink = new CanvasSink(track, {
			width: size.width,
			height: size.height,
			fit: 'fill',
			poolSize: 1
		});
		// AVC can use the browser's native encoder. Keep WebM for browsers without AVC encoding.
		const codec = (await canEncodeVideo('avc', { ...size, bitrate: AVC_PROXY_BITRATE }))
			? 'avc'
			: await getFirstEncodableVideoCodec(['vp9', 'vp8'], { ...size, bitrate: PROXY_BITRATE });
		if (!codec) throw new Error('This browser cannot encode a preview proxy.');
		const format = codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat();

		const target = new BufferTarget();
		output = new Output({ format, target });
		const source = new VideoSampleSource({
			codec,
			bitrate: codec === 'avc' ? AVC_PROXY_BITRATE : PROXY_BITRATE,
			keyFrameInterval: PROXY_KEYFRAME_SECONDS,
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
			try {
				await source.add(sample);
			} finally {
				sample.close();
			}

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
			blob: new Blob([target.buffer], { type: format.mimeType })
		} satisfies ProxyWorkerResponse);
	} catch (error) {
		if (output?.state === 'started') await output.cancel().catch(() => undefined);
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		} satisfies ProxyWorkerResponse);
	} finally {
		input?.dispose();
	}
};
