import { startProfileSpan } from '$lib/performance/profiling';
import type { VideoSample, VideoSampleSink, VideoSinkDecoderOptions } from 'mediabunny';

type HardwareAcceleration = NonNullable<VideoSinkDecoderOptions['hardwareAcceleration']>;
type SampleSink = Pick<VideoSampleSink, 'samples'>;

interface RenderedVideoFrame {
	source: VideoFrame;
	width: number;
	height: number;
	timestamp: number;
}

// Scrubbing across a gap should seek, not decode every skipped frame.
const MAX_FORWARD_DECODE_SECONDS = 1;
const REVERSE_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_REVERSE_CACHE_FRAMES = 30;

interface DecoderOptions {
	width: number;
	height: number;
	reverseFps?: number;
}

function isWebCodecsDecodingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const normalizedMessage = message.trim().toLowerCase().replace(/[.]+$/, '');
	if (normalizedMessage === 'decoding error') return true;

	return (
		typeof DOMException !== 'undefined' &&
		error instanceof DOMException &&
		error.name === 'EncodingError'
	);
}

/** Keeps sequential reads on one bounded decoder, with a software retry on decode failure. */
export class ResilientVideoFrameDecoder {
	private sink: SampleSink;
	private software = false;
	private stream: ReturnType<VideoSampleSink['samples']> | null = null;
	private current: VideoSample | null = null;
	private next: VideoSample | null = null;
	private rendered: RenderedVideoFrame | null = null;
	private lastTimestamp = -Infinity;
	private ended = false;
	private readonly reverseFrames: RenderedVideoFrame[] = [];
	private readonly reverseCapacity: number;
	private readonly reverseWindowSeconds: number;
	private reverseEndTimestamp = -Infinity;

	constructor(
		private readonly createSink: (hardwareAcceleration: HardwareAcceleration) => SampleSink,
		private readonly options: DecoderOptions
	) {
		this.reverseCapacity =
			options.reverseFps !== undefined
				? Math.max(
						1,
						Math.min(
							MAX_REVERSE_CACHE_FRAMES,
							Math.floor(REVERSE_CACHE_BYTES / (options.width * options.height * 4))
						)
					)
				: 0;
		this.reverseWindowSeconds =
			options.reverseFps !== undefined
				? Math.min(1, (this.reverseCapacity - 1) / Math.max(1, options.reverseFps))
				: 0;
		this.sink = createSink('no-preference');
	}

	/** The returned frame is borrowed until the next read or disposal. */
	async getFrame(timestamp: number): Promise<RenderedVideoFrame | null> {
		const finishProfile = startProfileSpan('Video decode', 'Frame');
		try {
			return await this.read(timestamp);
		} catch (error) {
			if (this.software || !isWebCodecsDecodingError(error)) throw error;
			await this.reset();
			this.software = true;
			this.sink = this.createSink('prefer-software');
			return await this.read(timestamp);
		} finally {
			finishProfile?.();
		}
	}

	private async read(timestamp: number): Promise<RenderedVideoFrame | null> {
		if (this.reverseCapacity > 0) return this.readReverse(timestamp);
		if (
			timestamp < this.lastTimestamp ||
			timestamp - this.lastTimestamp > MAX_FORWARD_DECODE_SECONDS
		) {
			await this.reset();
		}
		this.lastTimestamp = timestamp;
		this.stream ??= this.sink.samples(timestamp);
		while (!this.ended) {
			if (!this.next) {
				const result = await this.stream.next();
				this.ended = result.done === true;
				this.next = result.value ?? null;
			}
			if (!this.next || this.next.timestamp > timestamp + 1e-10) break;
			this.current?.close();
			this.rendered?.source.close();
			this.rendered = null;
			this.current = this.next;
			this.next = null;
		}
		if (!this.current) return null;
		this.rendered ??= await this.renderSample(this.current);
		return this.rendered;
	}

	private async readReverse(timestamp: number): Promise<RenderedVideoFrame | null> {
		const first = this.reverseFrames[0];
		if (!first || timestamp < first.timestamp || timestamp > this.reverseEndTimestamp) {
			await this.reset();
			this.reverseEndTimestamp = timestamp;
			this.stream = this.sink.samples(
				Math.max(0, timestamp - this.reverseWindowSeconds),
				timestamp + 1e-10
			);
			try {
				for await (const sample of this.stream) {
					try {
						if (this.reverseFrames.length === this.reverseCapacity)
							this.reverseFrames.shift()?.source.close();
						this.reverseFrames.push(await this.renderSample(sample));
					} finally {
						sample.close();
					}
				}
			} finally {
				await this.stream.return();
				this.stream = null;
			}
		}
		return this.reverseFrames.findLast((frame) => frame.timestamp <= timestamp + 1e-10) ?? null;
	}

	private async renderSample(sample: VideoSample): Promise<RenderedVideoFrame> {
		// Transform only the selected source frame. The library preserves rotation, pixel aspect
		// ratio, black letterboxing and mipmapped downscaling without painting skipped frames.
		const transformed = await sample.transform({
			width: this.options.width,
			height: this.options.height,
			fit: 'contain',
			alpha: 'discard'
		});
		try {
			return {
				source: transformed.toVideoFrame(),
				width: this.options.width,
				height: this.options.height,
				timestamp: sample.timestamp
			};
		} finally {
			transformed.close();
		}
	}

	private async reset(): Promise<void> {
		const stream = this.stream;
		this.stream = null;
		this.current?.close();
		this.next?.close();
		this.rendered?.source.close();
		this.rendered = null;
		this.current = null;
		this.next = null;
		this.ended = false;
		for (const frame of this.reverseFrames) frame.source.close();
		this.reverseFrames.length = 0;
		await stream?.return();
	}

	dispose(): void {
		void this.reset().catch(() => undefined);
	}
}
