import { describe, expect, it } from 'vitest';
import {
	SequentialVideoSampler,
	type ClosableVideoSample,
	type SparseVideoSampleSink
} from './sequential-video-sampler';

class FakeSample implements ClosableVideoSample {
	closed = false;

	constructor(readonly timestamp: number) {}

	close(): void {
		this.closed = true;
	}
}

class FakeSink implements SparseVideoSampleSink<FakeSample> {
	readonly requested: number[] = [];
	active = 0;
	peakActive = 0;
	returned = false;

	async *samplesAtTimestamps(
		timestamps: AsyncIterable<number>
	): AsyncGenerator<FakeSample | null, void, unknown> {
		try {
			for await (const timestamp of timestamps) {
				this.active += 1;
				this.peakActive = Math.max(this.peakActive, this.active);
				await Promise.resolve();
				this.requested.push(timestamp);
				this.active -= 1;
				yield new FakeSample(timestamp);
			}
		} finally {
			this.returned = true;
		}
	}
}

describe('SequentialVideoSampler', () => {
	it('serializes sparse frame requests through one bounded iterator', async () => {
		const sink = new FakeSink();
		const sampler = new SequentialVideoSampler(sink);

		const samples = await Promise.all([sampler.sample(0), sampler.sample(1 / 30), sampler.sample(2 / 30)]);

		expect(samples.map((sample) => sample?.timestamp)).toEqual([0, 1 / 30, 2 / 30]);
		expect(sink.requested).toEqual([0, 1 / 30, 2 / 30]);
		expect(sink.peakActive).toBe(1);
		expect(sampler.diagnostics).toMatchObject({
			request_count: 3,
			discontinuity_count: 0
		});
		sampler.dispose();
		await Promise.resolve();
	});

	it('records discontinuous seeks and closes the timestamp stream', async () => {
		const sink = new FakeSink();
		const sampler = new SequentialVideoSampler(sink);

		await sampler.sample(0);
		await sampler.sample(2);
		await sampler.sample(0.5);
		expect(sampler.diagnostics.discontinuity_count).toBe(2);

		sampler.dispose();
		await Promise.resolve();
		await Promise.resolve();
		expect(sink.returned).toBe(true);
		await expect(sampler.sample(3)).rejects.toThrow('disposed');
	});
});
