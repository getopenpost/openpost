import { describe, expect, it } from 'vitest';
import {
	SequentialVideoSampler,
	type ClosableVideoSample,
	type SequentialVideoSampleSink
} from './sequential-video-sampler';

class FakeSample implements ClosableVideoSample {
	closed = false;

	constructor(readonly timestamp: number) {}

	clone(): this {
		return new FakeSample(this.timestamp) as this;
	}

	close(): void {
		this.closed = true;
	}
}

class FakeSink implements SequentialVideoSampleSink<FakeSample> {
	readonly starts: number[] = [];
	active = 0;
	peakActive = 0;
	returned = false;

	async *samples(startTimestamp = 0): AsyncGenerator<FakeSample, void, unknown> {
		this.starts.push(startTimestamp);
		try {
			for (let index = Math.floor(startTimestamp * 30); index < 300; index++) {
				this.active += 1;
				this.peakActive = Math.max(this.peakActive, this.active);
				await Promise.resolve();
				this.active -= 1;
				yield new FakeSample(index / 30);
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

		const samples = await Promise.all([
			sampler.sample(0),
			sampler.sample(1 / 30),
			sampler.sample(2 / 30)
		]);

		expect(samples.map((sample) => sample?.timestamp)).toEqual([0, 1 / 30, 2 / 30]);
		expect(sink.starts).toEqual([0]);
		expect(sink.peakActive).toBe(1);
		expect(sampler.diagnostics).toMatchObject({
			request_count: 3,
			discontinuity_count: 0,
			retained_sample_count: 2
		});
		for (const sample of samples) sample?.close();
		await sampler.dispose();
	});

	it('records discontinuous seeks and closes the timestamp stream', async () => {
		const sink = new FakeSink();
		const sampler = new SequentialVideoSampler(sink);

		await sampler.sample(0);
		await sampler.sample(4);
		await sampler.sample(0.5);
		expect(sampler.diagnostics.discontinuity_count).toBe(2);
		expect(sink.starts).toEqual([0, 4, 0.5]);

		await sampler.dispose();
		expect(sink.returned).toBe(true);
		await expect(sampler.sample(3)).rejects.toThrow('disposed');
	});

	it('keeps the current iterator when a slow frame creates a modest forward gap', async () => {
		const sink = new FakeSink();
		const sampler = new SequentialVideoSampler(sink);

		await sampler.sample(0);
		await sampler.sample(1.25);

		expect(sink.starts).toEqual([0]);
		expect(sampler.diagnostics.discontinuity_count).toBe(0);
		await sampler.dispose();
	});
});
