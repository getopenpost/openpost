export interface ClosableVideoSample {
	close(): void;
}

export interface SparseVideoSampleSink<Sample extends ClosableVideoSample> {
	samplesAtTimestamps(timestamps: AsyncIterable<number>): AsyncGenerator<Sample | null, void, unknown>;
}

/**
 * Keeps one Mediabunny sparse-sample iterator alive across preview/export frames.
 *
 * Mediabunny backs this iterator with a WebCodecs VideoDecoder, seeks from the
 * nearest verified key packet, and bounds its encoded/decoded queues. Feeding
 * monotonically increasing timestamps through one iterator avoids reopening a
 * decoder and replaying the same GOP for every rendered frame.
 */
export class SequentialVideoSampler<Sample extends ClosableVideoSample> {
	private readonly timestamps = new TimestampQueue();
	private readonly samples: AsyncGenerator<Sample | null, void, unknown>;
	private tail: Promise<void> = Promise.resolve();
	private disposed = false;
	private lastTimestamp = Number.NEGATIVE_INFINITY;
	private requestCount = 0;
	private discontinuityCount = 0;

	constructor(sink: SparseVideoSampleSink<Sample>) {
		this.samples = sink.samplesAtTimestamps(this.timestamps);
	}

	get diagnostics(): {
		request_count: number;
		discontinuity_count: number;
		last_timestamp: number | null;
	} {
		return {
			request_count: this.requestCount,
			discontinuity_count: this.discontinuityCount,
			last_timestamp: Number.isFinite(this.lastTimestamp) ? this.lastTimestamp : null
		};
	}

	sample(timestamp: number): Promise<Sample | null> {
		if (this.disposed) return Promise.reject(new Error('The video sampler has been disposed.'));
		const task = this.tail.then(async () => {
			if (this.disposed) throw new Error('The video sampler has been disposed.');
			if (
				Number.isFinite(this.lastTimestamp) &&
				(timestamp < this.lastTimestamp || timestamp - this.lastTimestamp > 0.5)
			) {
				this.discontinuityCount += 1;
			}
			this.requestCount += 1;
			this.lastTimestamp = timestamp;
			this.timestamps.push(timestamp);
			const result = await this.samples.next();
			if (result.done) return null;
			return result.value;
		});
		this.tail = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.timestamps.close();
		void this.tail
			.then(() => this.samples.return(undefined))
			.catch(() => undefined);
	}
}

class TimestampQueue implements AsyncIterableIterator<number> {
	private readonly values: number[] = [];
	private waiting:
		| {
				resolve: (result: IteratorResult<number>) => void;
		  }
		| undefined;
	private closed = false;

	push(value: number): void {
		if (this.closed) throw new Error('The timestamp queue has been closed.');
		if (this.waiting) {
			const { resolve } = this.waiting;
			this.waiting = undefined;
			resolve({ done: false, value });
			return;
		}
		this.values.push(value);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.values.length = 0;
		this.waiting?.resolve({ done: true, value: undefined });
		this.waiting = undefined;
	}

	next(): Promise<IteratorResult<number>> {
		const value = this.values.shift();
		if (value !== undefined) return Promise.resolve({ done: false, value });
		if (this.closed) return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve) => {
			this.waiting = { resolve };
		});
	}

	return(): Promise<IteratorResult<number>> {
		this.close();
		return Promise.resolve({ done: true, value: undefined });
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<number> {
		return this;
	}
}
