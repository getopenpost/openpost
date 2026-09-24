import type { CanvasSink, VideoSinkDecoderOptions, WrappedCanvas } from 'mediabunny';

type HardwareAcceleration = NonNullable<VideoSinkDecoderOptions['hardwareAcceleration']>;
type VideoCanvasSink = Pick<CanvasSink, 'getCanvas'>;

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

/** Retries a failed source decode with software WebCodecs decoding. */
export class ResilientVideoCanvasDecoder {
	private sink: VideoCanvasSink;
	private softwareSinkPromise: Promise<void> | null = null;

	constructor(
		private readonly createSink: (hardwareAcceleration: HardwareAcceleration) => VideoCanvasSink
	) {
		this.sink = createSink('no-preference');
	}

	async getCanvas(timestamp: number): Promise<WrappedCanvas | null> {
		try {
			return await this.sink.getCanvas(timestamp);
		} catch (error) {
			if (!isWebCodecsDecodingError(error)) throw error;
			await this.useSoftwareSink();
			return this.sink.getCanvas(timestamp);
		}
	}

	private async useSoftwareSink(): Promise<void> {
		this.softwareSinkPromise ??= Promise.resolve().then(() => {
			this.sink = this.createSink('prefer-software');
		});
		await this.softwareSinkPromise;
	}
}
