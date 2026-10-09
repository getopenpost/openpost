import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createReverseShuttleScheduler } from './reverse-shuttle-scheduler';

let context: AudioContext;
let scheduler: ReturnType<typeof createReverseShuttleScheduler>;
let now: number;
let cursor: number;
let reversed: boolean;
let sourceAtOffset: (offsetSeconds: number) => number;
let grains: { source: AudioBufferSourceNode; samples: Float32Array; when: number }[];

beforeEach(() => {
	context = new AudioContext({ sampleRate: 48000 });
	now = 0;
	cursor = 1;
	reversed = false;
	sourceAtOffset = (offset) => cursor + (reversed ? 1 : -1) * offset;
	grains = [];
	vi.spyOn(context, 'currentTime', 'get').mockImplementation(() => now);
	const create = context.createBufferSource.bind(context);
	vi.spyOn(context, 'createBufferSource').mockImplementation(() => {
		const source = create();
		const start = source.start.bind(source);
		vi.spyOn(source, 'start').mockImplementation((when = 0) => {
			if (grains.length >= 8)
				throw new Error('Scheduling did not advance past the source boundary');
			grains.push({ source, samples: new Float32Array(source.buffer!.getChannelData(0)), when });
			start(when);
		});
		return source;
	});
	// The sample value is its source time, allowing independent checks of the
	// exact audio selected without duplicating the scheduler's planning code.
	const buffer = context.createBuffer(1, 96000, 48000);
	for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = i / 48000;
	const destination = context.createGain();
	destination.gain.value = 0;
	destination.connect(context.destination);
	scheduler = createReverseShuttleScheduler({
		context,
		buffer,
		bufferStartSeconds: 0,
		getSourceTimeAtOffset: (offset) => sourceAtOffset(offset),
		getTransportRate: () => -1,
		getGain: () => 1,
		destination
	});
});

afterEach(async () => {
	scheduler.dispose();
	vi.restoreAllMocks();
	await context.close();
});

it.each(
	[false, true].flatMap((direction) =>
		[0.004, 0.005, 0.011].map((duration) => ({ direction, duration }))
	)
)(
	'plays a $duration second source-boundary tail (authored reverse: $direction)',
	({ direction, duration }) => {
		reversed = direction;
		cursor = direction ? 2 - duration : duration;
		scheduler.schedule();
		expect(grains).toHaveLength(1);
		const samples = grains[0]!.samples;
		expect(samples.length).toBe(Math.round(duration * 48000));
		expect(samples[0]).toBeCloseTo(direction ? 2 - duration : duration - 1 / 48000, 4);
		expect(samples.at(-1)).toBeCloseTo(direction ? 2 - 1 / 48000 : 0, 4);
	}
);

it('resumes at the current source position after the scheduling queue underruns', () => {
	scheduler.schedule();
	grains.length = 0;
	now = 0.25;
	cursor = 0.75;
	scheduler.schedule();
	expect(grains.length).toBeGreaterThan(0);
	expect(grains[0]!.samples[0]).toBeCloseTo(0.75 - 1 / 48000, 4);
});

it('replaces queued audio when the authored direction changes', () => {
	scheduler.schedule();
	const stop = vi.spyOn(grains[0]!.source, 'stop');
	grains.length = 0;
	now = 0.03;
	cursor = 0.97;
	reversed = true;
	scheduler.schedule();
	expect(stop).toHaveBeenCalled();
	expect(grains.length).toBeGreaterThan(0);
	expect(grains[0]!.samples[0]).toBeCloseTo(0.97, 4);
	expect(grains[0]!.samples.at(-1)).toBeGreaterThan(grains[0]!.samples[0]!);
});

it.each([0.04, 0.08])(
	'queues the correct source interval across a rate boundary at %ss',
	(boundary) => {
		sourceAtOffset = (offset) =>
			1 - Math.min(offset, boundary) * 2 - Math.max(0, offset - boundary);
		scheduler.schedule();
		expect(grains).toHaveLength(2);
		// The first 80ms consumes the 2x section followed by the remaining 1x
		// section. The second 80ms is entirely 1x, even though it is queued early.
		expect(grains[0]!.source.playbackRate.value).toBeCloseTo(
			(boundary * 2 + 0.08 - boundary) / 0.08
		);
		expect(grains[1]!.source.playbackRate.value).toBe(1);
		expect(grains[1]!.samples[0]).toBeCloseTo(1 - boundary - 0.08 - 1 / 48000, 4);
		expect(grains[1]!.samples.at(-1)).toBeCloseTo(1 - boundary - 0.16, 4);
	}
);

it('keeps queued source samples contiguous between frame-rounded playhead updates', () => {
	scheduler.schedule();
	const previousEnd = grains.at(-1)!.samples.at(-1)!;
	grains.length = 0;
	// Audio time has advanced, but the 30fps playhead has not reached its next frame.
	now = 0.03;
	scheduler.schedule();
	expect(grains).toHaveLength(1);
	expect(grains[0]!.samples[0]).toBeCloseTo(previousEnd - 1 / 48000, 4);
});
