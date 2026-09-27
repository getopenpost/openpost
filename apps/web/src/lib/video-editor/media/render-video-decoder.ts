import { startProfileSpan } from '$lib/performance/profiling';
import type { VideoSample, VideoSampleSink, VideoSinkDecoderOptions } from 'mediabunny';

type HardwareAcceleration = NonNullable<VideoSinkDecoderOptions['hardwareAcceleration']>;
type SampleSink = Pick<VideoSampleSink, 'samples' | 'samplesAtTimestamps'>;

interface RenderedVideoFrame {
	source: VideoFrame;
	width: number;
	height: number;
	timestamp: number;
}

// Scrubbing across a gap should seek, not decode every skipped frame.
const MAX_SEQUENTIAL_DECODE_SECONDS = 1;
const REVERSE_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_REVERSE_CACHE_FRAMES = 30;

interface DecoderOptions {
	width: number;
	height: number;
	reverse?: boolean;
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
	private readonly reverseFrames = new Map<number, RenderedVideoFrame | null>();
	private reverseStream: ReturnType<VideoSampleSink['samplesAtTimestamps']> | null = null;
	private readonly reverseCapacity: number;

	constructor(
		private readonly createSink: (hardwareAcceleration: HardwareAcceleration) => SampleSink,
		private readonly options: DecoderOptions
	) {
		this.reverseCapacity =
			options.reverse === true
				? Math.max(
						1,
						Math.min(
							MAX_REVERSE_CACHE_FRAMES,
							Math.floor(REVERSE_CACHE_BYTES / (options.width * options.height * 4))
						)
					)
				: 0;
		this.sink = createSink('no-preference');
	}

	/** The returned frame is borrowed until the next read or disposal. Upcoming times bound reverse prefetch. */
	async getFrame(
		timestamp: number,
		upcomingTimestamps: Iterable<number> = []
	): Promise<RenderedVideoFrame | null> {
		const reverseTimestamps = [timestamp];
		if (this.reverseCapacity > 0 && !this.reverseFrames.has(timestamp)) {
			for (const upcoming of upcomingTimestamps) {
				if (
					reverseTimestamps.length >= this.reverseCapacity ||
					Math.abs(upcoming - timestamp) > MAX_SEQUENTIAL_DECODE_SECONDS
				)
					break;
				reverseTimestamps.push(upcoming);
			}
		}
		const finishProfile = startProfileSpan('Video decode', 'Frame');
		try {
			return await this.read(timestamp, reverseTimestamps);
		} catch (error) {
			if (this.software || !isWebCodecsDecodingError(error)) throw error;
			await this.reset();
			this.software = true;
			this.sink = this.createSink('prefer-software');
			return await this.read(timestamp, reverseTimestamps);
		} finally {
			finishProfile?.();
		}
	}

	private async read(
		timestamp: number,
		reverseTimestamps: readonly number[]
	): Promise<RenderedVideoFrame | null> {
		if (this.reverseCapacity > 0) return this.readReverse(timestamp, reverseTimestamps);
		if (
			timestamp < this.lastTimestamp ||
			timestamp - this.lastTimestamp > MAX_SEQUENTIAL_DECODE_SECONDS
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

	private async readReverse(
		timestamp: number,
		requestedTimestamps: readonly number[]
	): Promise<RenderedVideoFrame | null> {
		if (this.reverseFrames.has(timestamp)) return this.reverseFrames.get(timestamp)!;
		await this.reset();
		// Sorting lets the decoder visit each packet once. Cache by requested time, because
		// variable frame rates and speed ramps need not land on source frame boundaries.
		const timestamps = [...new Set(requestedTimestamps)].sort((a, b) => a - b);
		const stream = this.sink.samplesAtTimestamps(timestamps);
		this.reverseStream = stream;
		try {
			let index = 0;
			for await (const sample of stream) {
				try {
					this.reverseFrames.set(
						timestamps[index++]!,
						sample ? await this.renderSample(sample) : null
					);
				} finally {
					sample?.close();
				}
			}
		} finally {
			await stream.return();
			this.reverseStream = null;
		}
		return this.reverseFrames.get(timestamp) ?? null;
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
		const reverseStream = this.reverseStream;
		this.stream = null;
		this.reverseStream = null;
		this.current?.close();
		this.next?.close();
		this.rendered?.source.close();
		this.rendered = null;
		this.current = null;
		this.next = null;
		this.ended = false;
		for (const frame of this.reverseFrames.values()) frame?.source.close();
		this.reverseFrames.clear();
		await stream?.return();
		await reverseStream?.return();
	}

	dispose(): void {
		void this.reset().catch(() => undefined);
	}
}
