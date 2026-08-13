export interface ClosableVideoSample {
	readonly timestamp: number;
	clone(): this;
	close(): void;
}

export interface SequentialVideoSampleSink<Sample extends ClosableVideoSample> {
	samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<Sample, void, unknown>;
}

// A slow first decode can move the UI clock by more than 500 ms before the
// next request reaches the worker. Keep walking the active GOP for modest
// forward gaps so playback can recover instead of repeatedly reopening the
// decoder at a keyframe. Larger jumps and every backward seek still restart.
const MAX_SEQUENTIAL_FORWARD_GAP_SECONDS = 2;

/**
 * Keeps one Mediabunny/WebCodecs decode iterator alive during sequential
 * playback and export.
 *
 * The iterator starts from the nearest verified key packet. One retained frame
 * and one look-ahead frame are enough to answer monotonically increasing frame
 * requests without replaying the same GOP. Backward and large forward jumps
 * close the iterator and start a fresh keyframe-aware seek.
 */
export class SequentialVideoSampler<Sample extends ClosableVideoSample> {
	private iterator: AsyncGenerator<Sample, void, unknown> | undefined;
	private current: Sample | undefined;
	private lookahead: Sample | undefined;
	private tail: Promise<void> = Promise.resolve();
	private disposed = false;
	private lastTimestamp = Number.NEGATIVE_INFINITY;
	private requestCount = 0;
	private discontinuityCount = 0;

	constructor(private readonly sink: SequentialVideoSampleSink<Sample>) {}

	get diagnostics(): {
		request_count: number;
		discontinuity_count: number;
		last_timestamp: number | null;
		retained_sample_count: number;
	} {
		return {
			request_count: this.requestCount,
			discontinuity_count: this.discontinuityCount,
			last_timestamp: Number.isFinite(this.lastTimestamp) ? this.lastTimestamp : null,
			retained_sample_count: Number(Boolean(this.current)) + Number(Boolean(this.lookahead))
		};
	}

	sample(timestamp: number): Promise<Sample | null> {
		if (this.disposed) return Promise.reject(new Error('The video sampler has been disposed.'));
		const task = this.tail.then(async () => {
			if (this.disposed) throw new Error('The video sampler has been disposed.');
			const discontinuous =
				Number.isFinite(this.lastTimestamp) &&
				(timestamp < this.lastTimestamp ||
					timestamp - this.lastTimestamp > MAX_SEQUENTIAL_FORWARD_GAP_SECONDS);
			if (discontinuous) {
				this.discontinuityCount += 1;
				await this.restart(timestamp);
			} else if (!this.iterator) {
				await this.restart(timestamp);
			}
			this.requestCount += 1;
			this.lastTimestamp = timestamp;
			await this.advanceTo(timestamp);
			return this.current?.clone() ?? null;
		});
		this.tail = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.tail;
		await this.closeIterator();
	}

	private async restart(timestamp: number): Promise<void> {
		await this.closeIterator();
		this.iterator = this.sink.samples(Math.max(0, timestamp));
		const first = await this.iterator.next();
		if (!first.done) this.current = first.value;
	}

	private async advanceTo(timestamp: number): Promise<void> {
		if (!this.iterator || !this.current) return;
		while (true) {
			if (!this.lookahead) {
				const next = await this.iterator.next();
				if (next.done) return;
				this.lookahead = next.value;
			}
			if (this.lookahead.timestamp > timestamp) return;
			this.current.close();
			this.current = this.lookahead;
			this.lookahead = undefined;
		}
	}

	private async closeIterator(): Promise<void> {
		this.current?.close();
		this.lookahead?.close();
		this.current = undefined;
		this.lookahead = undefined;
		const iterator = this.iterator;
		this.iterator = undefined;
		if (iterator) await iterator.return(undefined).catch(() => undefined);
	}
}
