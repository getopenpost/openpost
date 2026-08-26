// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVERSE_SHUTTLE_GRAIN_FADE_SECONDS } from './reverse-shuttle-grain';
import { createReverseShuttleScheduler } from './reverse-shuttle-scheduler';

interface MockAudioBuffer {
	numberOfChannels: number;
	length: number;
	sampleRate: number;
	duration: number;
	getChannelData(channel: number): Float32Array;
}

interface MockBufferSource {
	buffer: AudioBuffer | null;
	playbackRate: { value: number };
	connect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	onended: (() => void) | null;
}

interface MockGain {
	gain: {
		value: number;
		setValueAtTime: ReturnType<typeof vi.fn>;
		linearRampToValueAtTime: ReturnType<typeof vi.fn>;
	};
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

interface MockContext {
	currentTime: number;
	state: AudioContextState;
	resume: ReturnType<typeof vi.fn>;
	createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
	createBufferSource(): AudioBufferSourceNode;
	createGain(): GainNode;
	createdBuffers: MockAudioBuffer[];
	createdSources: MockBufferSource[];
	createdGains: MockGain[];
}

function asAudioBuffer(buffer: MockAudioBuffer): AudioBuffer {
	// SAFETY: the scheduler only reads the AudioBuffer fields implemented by this focused test double.
	return buffer as AudioBuffer;
}

function asBufferSource(source: MockBufferSource): AudioBufferSourceNode {
	// SAFETY: the scheduler only uses the source fields and methods implemented by this focused test double.
	return source as AudioBufferSourceNode;
}

function asGainNode(gain: MockGain): GainNode {
	// SAFETY: the scheduler only uses the gain fields and methods implemented by this focused test double.
	return gain as GainNode;
}

function asAudioContext(context: MockContext): AudioContext {
	// SAFETY: the scheduler only uses the AudioContext fields and factories implemented by this harness.
	return context as AudioContext;
}

function asAudioNode(gain: MockGain): AudioNode {
	// SAFETY: the scheduler only connects envelopes to this destination and the mock implements connect.
	return gain as AudioNode;
}

function createBuffer(
	channelCount = 1,
	durationSeconds = 10,
	sampleRate = 48_000
): MockAudioBuffer {
	const length = Math.round(durationSeconds * sampleRate);
	const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
	return {
		numberOfChannels: channelCount,
		length,
		sampleRate,
		duration: durationSeconds,
		getChannelData(channel) {
			const data = channels[channel];
			if (!data) throw new RangeError(`Missing audio channel ${channel}`);
			return data;
		}
	};
}

function createGain(): MockGain {
	return {
		gain: {
			value: 1,
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn()
		},
		connect: vi.fn(),
		disconnect: vi.fn()
	};
}

function createSource(): MockBufferSource {
	return {
		buffer: null,
		playbackRate: { value: 1 },
		connect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		disconnect: vi.fn(),
		onended: null
	};
}

function createContext(state: AudioContextState = 'running'): MockContext {
	const createdBuffers: MockAudioBuffer[] = [];
	const createdSources: MockBufferSource[] = [];
	const createdGains: MockGain[] = [];
	return {
		currentTime: 0,
		state,
		resume: vi.fn(async () => undefined),
		createBuffer(channels, length, sampleRate) {
			const buffer = createBuffer(channels, length / sampleRate, sampleRate);
			createdBuffers.push(buffer);
			return asAudioBuffer(buffer);
		},
		createBufferSource() {
			const source = createSource();
			createdSources.push(source);
			return asBufferSource(source);
		},
		createGain() {
			const gain = createGain();
			createdGains.push(gain);
			return asGainNode(gain);
		},
		createdBuffers,
		createdSources,
		createdGains
	};
}

function createScheduler(
	context: MockContext,
	buffer: MockAudioBuffer,
	overrides: Partial<{
		authoredPlaybackRate: number;
		authoredReversed: boolean;
		getTransportRate: () => number;
		getGain: () => number;
		getSourceCursorSeconds: () => number;
	}> = {}
) {
	return createReverseShuttleScheduler({
		context: asAudioContext(context),
		buffer: asAudioBuffer(buffer),
		bufferStartSeconds: 0,
		getSourceCursorSeconds: overrides.getSourceCursorSeconds ?? (() => 5),
		authoredPlaybackRate: overrides.authoredPlaybackRate ?? 1,
		authoredReversed: overrides.authoredReversed ?? false,
		getTransportRate: overrides.getTransportRate ?? (() => -1),
		getGain: overrides.getGain ?? (() => 1),
		destination: asAudioNode(createGain())
	});
}

describe('createReverseShuttleScheduler', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('schedules reversed samples at the combined rate with a bounded gain envelope', () => {
		const context = createContext('suspended');
		const buffer = createBuffer();
		const samples = buffer.getChannelData(0);
		for (let index = 0; index < samples.length; index += 1) samples[index] = index;
		const scheduler = createScheduler(context, buffer, {
			authoredPlaybackRate: 2,
			getTransportRate: () => -2,
			getGain: () => 0.35
		});

		scheduler.start();

		expect(context.resume).toHaveBeenCalledOnce();
		expect(context.createdSources.length).toBeGreaterThan(0);
		expect(context.createdSources[0]?.playbackRate.value).toBe(4);
		const grain = context.createdBuffers[0]?.getChannelData(0);
		expect(grain).toBeDefined();
		expect(grain?.[0]).toBeGreaterThan(grain?.[grain.length - 1] ?? Number.POSITIVE_INFINITY);
		const envelope = context.createdGains[0]?.gain;
		expect(envelope?.setValueAtTime).toHaveBeenNthCalledWith(1, 0, 0.01);
		expect(envelope?.linearRampToValueAtTime).toHaveBeenNthCalledWith(
			1,
			0.35,
			0.01 + REVERSE_SHUTTLE_GRAIN_FADE_SECONDS
		);
		expect(envelope?.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number));

		scheduler.dispose();
	});

	it('keeps sample order forward when the source was already reversed', () => {
		const context = createContext();
		const buffer = createBuffer();
		const samples = buffer.getChannelData(0);
		for (let index = 0; index < samples.length; index += 1) samples[index] = index;
		const scheduler = createScheduler(context, buffer, { authoredReversed: true });

		scheduler.start();

		const grain = context.createdBuffers[0]?.getChannelData(0);
		expect(grain).toBeDefined();
		expect(grain?.[0]).toBeLessThan(grain?.[grain.length - 1] ?? Number.NEGATIVE_INFINITY);
		scheduler.dispose();
	});

	it('stops queued grains on a forward switch and schedules nothing after disposal', () => {
		const context = createContext();
		const buffer = createBuffer();
		let transportRate = -2;
		const scheduler = createScheduler(context, buffer, {
			getTransportRate: () => transportRate
		});
		scheduler.start();
		expect(context.createdSources.length).toBeGreaterThan(0);
		const reverseSources = [...context.createdSources];

		transportRate = 1;
		vi.advanceTimersByTime(35);
		for (const source of reverseSources) {
			expect(source.stop).toHaveBeenCalledOnce();
			expect(source.disconnect).toHaveBeenCalledOnce();
		}

		transportRate = -2;
		vi.advanceTimersByTime(35);
		scheduler.dispose();
		const countAtDispose = context.createdSources.length;
		vi.advanceTimersByTime(200);
		expect(context.createdSources).toHaveLength(countAtDispose);
	});

	it('refuses a grain that would cross the decoded buffer boundary', () => {
		const context = createContext();
		const buffer = createBuffer(1, 0.1);
		const scheduler = createScheduler(context, buffer, {
			getSourceCursorSeconds: () => 0.05,
			getTransportRate: () => -4
		});

		scheduler.start();

		expect(context.createdSources).toHaveLength(0);
		expect(context.createdBuffers).toHaveLength(0);
		scheduler.dispose();
	});
});
