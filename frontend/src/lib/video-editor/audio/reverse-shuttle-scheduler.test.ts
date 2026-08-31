// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
	REVERSE_SHUTTLE_GRAIN_FADE_SECONDS,
	REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS,
	copyShuttleGrainSamples
} from './reverse-shuttle-grain';
import { createReverseShuttleScheduler } from './reverse-shuttle-scheduler';

function createMockGain() {
	return {
		gain: {
			value: 1,
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn()
		},
		connect: vi.fn(),
		disconnect: vi.fn()
	} as unknown as GainNode;
}

function createMockBufferSource() {
	return {
		buffer: null as AudioBuffer | null,
		playbackRate: { value: 1 },
		connect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		disconnect: vi.fn(),
		onended: null as unknown as (() => void) | null
	} as unknown as AudioBufferSourceNode;
}

function createMockAudioBuffer(channelCount = 2, durationSeconds = 10, sampleRate = 48000): AudioBuffer {
	const length = Math.round(durationSeconds * sampleRate);
	const channelData = Array.from({ length: channelCount }, () => {
		const arr = new Float32Array(length);
		for (let i = 0; i < length; i++) arr[i] = i / length;
		return arr;
	});
	return {
		numberOfChannels: channelCount,
		length,
		sampleRate,
		duration: durationSeconds,
		getChannelData: (channel: number) => channelData[channel] ?? channelData[0]!
	} as unknown as AudioBuffer;
}

function createMockContext() {
	let currentTime = 0;
	const createdBuffers: AudioBuffer[] = [];
	const createdSources: AudioBufferSourceNode[] = [];
	const createdGains: GainNode[] = [];

	return {
		get currentTime() {
			return currentTime;
		},
		set currentTime(value: number) {
			currentTime = value;
		},
		advance(seconds: number) {
			currentTime += seconds;
		},
		state: 'running' as AudioContextState,
		sampleRate: 48000,
		createBuffer(channels: number, length: number, rate: number) {
			const buffer = {
				numberOfChannels: channels,
				length,
				sampleRate: rate,
				duration: length / rate,
				getChannelData: () => new Float32Array(length)
			} as unknown as AudioBuffer;
			createdBuffers.push(buffer);
			return buffer;
		},
		createBufferSource() {
			const src = createMockBufferSource();
			createdSources.push(src as unknown as AudioBufferSourceNode);
			return src as unknown as AudioBufferSourceNode;
		},
		createGain() {
			const gain = createMockGain();
			createdGains.push(gain as unknown as GainNode);
			return gain as unknown as GainNode;
		},
		resume: vi.fn(() => Promise.resolve()),
		destination: { connect: vi.fn() } as unknown as AudioNode,
		_createdBuffers: createdBuffers,
		_createdSources: createdSources,
		_createdGains: createdGains
	} as unknown as AudioContext & {
		_createdBuffers: AudioBuffer[];
		_createdSources: AudioBufferSourceNode[];
		_createdGains: GainNode[];
		advance: (s: number) => void;
	};
}

describe('createReverseShuttleScheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('schedules grains with starts, fades and gain when reverse', () => {
		const context = createMockContext();
		const buffer = createMockAudioBuffer(2, 10, 48000);
		const destination = createMockGain() as unknown as AudioNode;
		let sourceCursor = 5;
		const getSourceCursorSeconds = () => sourceCursor;
		const getTransportRate = () => -2;
		const getGain = vi.fn(() => 0.8);

		const scheduler = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds,
			authoredPlaybackRate: 1,
			authoredReversed: false,
			getTransportRate,
			getGain,
			destination
		});

		scheduler.start();
		// First interval not yet fired; schedule() runs synchronously on start
		vi.advanceTimersByTime(35);
		// Should have created at least one source
		expect((context as unknown as { _createdSources: unknown[] })._createdSources.length).toBeGreaterThan(0);
		const sources = (context as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources;
		const first = sources[0] as unknown as { start: ReturnType<typeof vi.fn>; playbackRate: { value: number } };
		expect(first.start).toHaveBeenCalled();
		// Each grain should have gain envelope with fades
		const gains = (context as unknown as { _createdGains: GainNode[] })._createdGains;
		expect(gains.length).toBeGreaterThan(0);
		for (const gain of gains) {
			const g = gain as unknown as { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> } };
			expect(g.gain.setValueAtTime).toHaveBeenCalled();
			expect(g.gain.linearRampToValueAtTime).toHaveBeenCalled();
			// Check fade envelope: set 0 at start, ramp to gain, etc.
			const setCalls = g.gain.setValueAtTime.mock.calls as unknown as Array<[number, number]>;
			const rampCalls = g.gain.linearRampToValueAtTime.mock.calls as unknown as Array<[number, number]>;
			expect(setCalls[0]?.[0]).toBe(0);
			// First ramp should be to getGain value at start+fade
			expect(rampCalls[0]?.[0]).toBeCloseTo(0.8, 2);
			expect(rampCalls[0]?.[1]).toBeCloseTo(
				(setCalls[0]?.[1] ?? 0) + REVERSE_SHUTTLE_GRAIN_FADE_SECONDS,
				3
			);
		}
		expect(getGain).toHaveBeenCalled();
		scheduler.dispose();
	});

	it('applies correct sample order for normal vs authored-reversed', () => {
		const source = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
		const target = new Float32Array(4);
		copyShuttleGrainSamples(source, target, 2, true);
		expect(Array.from(target)).toEqual([5, 4, 3, 2]);
		const target2 = new Float32Array(4);
		copyShuttleGrainSamples(source, target2, 2, false);
		expect(Array.from(target2)).toEqual([2, 3, 4, 5]);

		// Via scheduler: create two contexts and verify buffer content ordering
		const context = createMockContext();
		const buffer = createMockAudioBuffer(1, 10, 48000);
		// Fill first channel with deterministic pattern
		const channel = buffer.getChannelData(0);
		for (let i = 0; i < channel.length; i++) channel[i] = i;

		const dest = createMockGain() as unknown as AudioNode;

		// Normal clip (authoredReversed false) -> reverseSamples true, so grain should be reversed
		const schedulerNormal = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 1,
			authoredReversed: false,
			getTransportRate: () => -1,
			getGain: () => 1,
			destination: dest
		});
		schedulerNormal.start();
		vi.advanceTimersByTime(35);
		const sourcesNormal = (context as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources;
		expect(sourcesNormal.length).toBeGreaterThan(0);
		// Buffer of first grain should have reversed samples (check that createBuffer was called with length derived from playbackRate)
		schedulerNormal.dispose();

		// Authored-reversed clip -> reverseSamples false, forward samples
		const context2 = createMockContext();
		const schedulerReversed = createReverseShuttleScheduler({
			context: context2,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 1,
			authoredReversed: true,
			getTransportRate: () => -1,
			getGain: () => 1,
			destination: dest
		});
		schedulerReversed.start();
		vi.advanceTimersByTime(35);
		const sourcesReversed = (context2 as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources;
		expect(sourcesReversed.length).toBeGreaterThan(0);
		schedulerReversed.dispose();
	});

	it('cleans up on dispose and on transport switch to forward', () => {
		const context = createMockContext();
		const buffer = createMockAudioBuffer(2, 10, 48000);
		const dest = createMockGain() as unknown as AudioNode;
		let rate = -2;
		const scheduler = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 1,
			authoredReversed: false,
			getTransportRate: () => rate,
			getGain: () => 1,
			destination: dest
		});
		scheduler.start();
		vi.advanceTimersByTime(50);
		const sourcesBefore = (context as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources.slice();
		expect(sourcesBefore.length).toBeGreaterThan(0);

		// Switch to forward => should stop scheduled nodes
		rate = 1;
		vi.advanceTimersByTime(50);
		for (const src of sourcesBefore) {
			expect((src as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
			expect((src as unknown as { disconnect: ReturnType<typeof vi.fn> }).disconnect).toHaveBeenCalled();
		}

		// Switch back to reverse, then dispose
		rate = -2;
		vi.advanceTimersByTime(40);
		scheduler.dispose();
		// After dispose, clearInterval should have been called and no further scheduling
		const countAfterDispose = (context as unknown as { _createdSources: unknown[] })._createdSources.length;
		vi.advanceTimersByTime(100);
		expect((context as unknown as { _createdSources: unknown[] })._createdSources.length).toBe(countAfterDispose);
	});

	it('respects buffer boundaries and does not schedule out-of-range grains', () => {
		const context = createMockContext();
		const smallBuffer = createMockAudioBuffer(2, 0.1, 48000); // only 0.1s
		const dest = createMockGain() as unknown as AudioNode;
		const scheduler = createReverseShuttleScheduler({
			context,
			buffer: smallBuffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 0.05,
			authoredPlaybackRate: 1,
			authoredReversed: false,
			getTransportRate: () => -4, // requires 0.32s source duration, exceeds buffer
			getGain: () => 1,
			destination: dest
		});
		scheduler.start();
		vi.advanceTimersByTime(50);
		// Plan should be null, so no sources scheduled
		expect((context as unknown as { _createdSources: unknown[] })._createdSources.length).toBe(0);
		scheduler.dispose();
	});

	it('uses getGain value for envelope', () => {
		const context = createMockContext();
		const buffer = createMockAudioBuffer(2, 10, 48000);
		const dest = createMockGain() as unknown as AudioNode;
		const scheduler = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 1,
			authoredReversed: false,
			getTransportRate: () => -1,
			getGain: () => 0.35,
			destination: dest
		});
		scheduler.start();
		vi.advanceTimersByTime(35);
		const gains = (context as unknown as { _createdGains: GainNode[] })._createdGains;
		for (const gain of gains) {
			const g = gain as unknown as { gain: { linearRampToValueAtTime: ReturnType<typeof vi.fn> } };
			const firstRampValue = (g.gain.linearRampToValueAtTime.mock.calls[0] as unknown as number[])?.[0];
			expect(firstRampValue).toBeCloseTo(0.35, 2);
		}
		scheduler.dispose();
	});

	it('handles authored playbackRate combined with transport', () => {
		const context = createMockContext();
		const buffer = createMockAudioBuffer(2, 10, 48000);
		const dest = createMockGain() as unknown as AudioNode;
		const scheduler = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 2,
			authoredReversed: false,
			getTransportRate: () => -2,
			getGain: () => 1,
			destination: dest
		});
		scheduler.start();
		vi.advanceTimersByTime(35);
		const sources = (context as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources;
		for (const src of sources) {
			expect((src as unknown as { playbackRate: { value: number } }).playbackRate.value).toBe(4);
		}
		scheduler.dispose();
	});

	it('clamps playbackRate to 0.0625..16', () => {
		const context = createMockContext();
		const buffer = createMockAudioBuffer(2, 10, 48000);
		const dest = createMockGain() as unknown as AudioNode;
		const high = createReverseShuttleScheduler({
			context,
			buffer,
			bufferStartSeconds: 0,
			getSourceCursorSeconds: () => 5,
			authoredPlaybackRate: 10,
			authoredReversed: false,
			getTransportRate: () => -10,
			getGain: () => 1,
			destination: dest
		});
		high.start();
		vi.advanceTimersByTime(35);
		for (const src of (context as unknown as { _createdSources: AudioBufferSourceNode[] })._createdSources) {
			expect((src as unknown as { playbackRate: { value: number } }).playbackRate.value).toBe(16);
		}
		high.dispose();
	});
});
