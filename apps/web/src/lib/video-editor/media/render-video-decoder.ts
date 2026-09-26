import type { CanvasSink, VideoSinkDecoderOptions, WrappedCanvas } from 'mediabunny';

type HardwareAcceleration = NonNullable<VideoSinkDecoderOptions['hardwareAcceleration']>;
type VideoCanvasSink = Pick<CanvasSink, 'canvases'>;

// Scrubbing across a gap should seek, not decode every skipped frame.
const MAX_FORWARD_DECODE_SECONDS = 1;
const REVERSE_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_REVERSE_CACHE_FRAMES = 30;

interface DecoderOptions {
	reverse?: { width: number; height: number; fps: number };
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
export class ResilientVideoCanvasDecoder {
	private sink: VideoCanvasSink;
	private software = false;
	private stream: ReturnType<CanvasSink['canvases']> | null = null;
	private current: WrappedCanvas | null = null;
	private next: WrappedCanvas | null = null;
	private lastTimestamp = -Infinity;
	private ended = false;
	private readonly reverseFrames: WrappedCanvas[] = [];
	private readonly reverseCapacity: number;
	private readonly reverseWindowSeconds: number;
	private reverseEndTimestamp = -Infinity;

	constructor(
		private readonly createSink: (
			hardwareAcceleration: HardwareAcceleration,
			poolSize: number
		) => VideoCanvasSink,
		options: DecoderOptions = {}
	) {
		this.reverseCapacity = options.reverse
			? Math.max(
					1,
					Math.min(
						MAX_REVERSE_CACHE_FRAMES,
						Math.floor(REVERSE_CACHE_BYTES / (options.reverse.width * options.reverse.height * 4))
					)
				)
			: 0;
		this.reverseWindowSeconds = options.reverse
			? Math.min(1, (this.reverseCapacity - 1) / Math.max(1, options.reverse.fps))
			: 0;
		this.sink = createSink('no-preference', this.reverseCapacity || 2);
	}

	async getCanvas(timestamp: number): Promise<WrappedCanvas | null> {
		try {
			return await this.read(timestamp);
		} catch (error) {
			if (this.software || !isWebCodecsDecodingError(error)) throw error;
			await this.reset();
			this.software = true;
			this.sink = this.createSink('prefer-software', this.reverseCapacity || 2);
			return this.read(timestamp);
		}
	}

	private async read(timestamp: number): Promise<WrappedCanvas | null> {
		if (this.reverseCapacity > 0) return this.readReverse(timestamp);
		if (
			timestamp < this.lastTimestamp ||
			timestamp - this.lastTimestamp > MAX_FORWARD_DECODE_SECONDS
		) {
			await this.reset();
		}
		this.lastTimestamp = timestamp;
		this.stream ??= this.sink.canvases(timestamp);
		while (!this.ended) {
			if (!this.next) {
				const result = await this.stream.next();
				this.ended = result.done === true;
				this.next = result.value ?? null;
			}
			if (!this.next || this.next.timestamp > timestamp + 1e-10) break;
			this.current = this.next;
			this.next = null;
		}
		return this.current;
	}

	private async readReverse(timestamp: number): Promise<WrappedCanvas | null> {
		const first = this.reverseFrames[0];
		if (!first || timestamp < first.timestamp || timestamp > this.reverseEndTimestamp) {
			await this.reset();
			this.reverseEndTimestamp = timestamp;
			this.stream = this.sink.canvases(
				Math.max(0, timestamp - this.reverseWindowSeconds),
				timestamp + 1e-10
			);
			try {
				for await (const frame of this.stream) {
					this.reverseFrames.push(frame);
					if (this.reverseFrames.length > this.reverseCapacity) this.reverseFrames.shift();
				}
			} finally {
				await this.stream.return();
				this.stream = null;
			}
		}
		return this.reverseFrames.findLast((frame) => frame.timestamp <= timestamp + 1e-10) ?? null;
	}

	private async reset(): Promise<void> {
		const stream = this.stream;
		this.stream = null;
		this.current = null;
		this.next = null;
		this.ended = false;
		this.reverseFrames.length = 0;
		await stream?.return();
	}

	dispose(): void {
		void this.reset().catch(() => undefined);
	}
}
