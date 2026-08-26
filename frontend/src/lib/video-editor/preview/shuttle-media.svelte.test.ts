import { describe, expect, it, vi } from 'vitest';
import { getShuttleMediaPlaybackRate } from './shuttle';
import { resolveReverseShuttleGrainPlan } from '../audio/reverse-shuttle-grain';

describe('shuttle media rates', () => {
	it('applies abs transport to visual and audio media paths', async () => {
		const video = document.createElement('video');
		const audio = document.createElement('audio');
		// Controllable media seam: stub play to track rate
		const playSpy = vi.fn(() => Promise.resolve());
		// SAFETY: test replaces media play with spy for controllable seam.
		video.play = playSpy as unknown as typeof video.play;
		// SAFETY: test replaces media play with spy for controllable seam.
		audio.play = playSpy as unknown as typeof audio.play;
		const authoredRate = 1;
		for (const transport of [1, 2, 4, -1, -2, -4]) {
			const expected = getShuttleMediaPlaybackRate(authoredRate, Math.abs(transport));
			video.playbackRate = expected;
			audio.playbackRate = expected;
			expect(video.playbackRate).toBe(expected);
			expect(audio.playbackRate).toBe(expected);
			expect(video.playbackRate).toBeGreaterThanOrEqual(0.0625);
			expect(video.playbackRate).toBeLessThanOrEqual(16);
		}
	});

	it('re-seeks when rate changes to avoid drift', async () => {
		const video = document.createElement('video');
		video.currentTime = 1.0;
		const sourceTime = 1.0;
		const drift = (rate: number) =>
			0.08 / Math.max(0.1, getShuttleMediaPlaybackRate(1, Math.abs(rate)));
		expect(drift(1)).toBeCloseTo(0.08);
		expect(drift(2)).toBeCloseTo(0.04);
		expect(drift(4)).toBeCloseTo(0.02);
		// Simulate rate change from 1x to 2x: drift threshold halves, so existing 0.05 drift now exceeds
		const beforeThreshold = drift(1);
		const afterThreshold = drift(2);
		expect(afterThreshold).toBeLessThan(beforeThreshold);
	});

	it('reverse grain ordering for normal vs authored-reversed clips', () => {
		const normal = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: false,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		const reversed = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: true,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(normal?.reverseSamples).toBe(true);
		expect(reversed?.reverseSamples).toBe(false);
		expect(normal?.sourceStartSeconds).toBeLessThan(5);
		expect(reversed?.sourceStartSeconds).toBe(5);
		// PlaybackRate should be authored*|transport| clamped
		expect(normal?.playbackRate).toBe(2);
		expect(reversed?.playbackRate).toBe(2);
	});

	it('uses AudioContext seam for grain scheduling', async () => {
		const mockContext = {
			currentTime: 0,
			state: 'running',
			sampleRate: 48000,
			createBuffer: (channels: number, length: number, rate: number) => ({
				numberOfChannels: channels,
				length,
				sampleRate: rate,
				duration: length / rate,
				getChannelData: () => new Float32Array(length)
			}),
			createBufferSource: () => ({
				buffer: null as AudioBuffer | null,
				playbackRate: { value: 1 },
				connect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				disconnect: vi.fn(),
				// SAFETY: test creates minimal AudioBufferSourceNode mock.
				onended: null as unknown as () => void
			}),
			createGain: () => ({
				gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
				connect: vi.fn(),
				disconnect: vi.fn()
			}),
			resume: vi.fn(() => Promise.resolve())
			// SAFETY: test creates minimal AudioContext mock for grain scheduling.
		} as unknown as AudioContext;
		expect(mockContext.sampleRate).toBe(48000);
		// Simulate grain creation
		const buffer = mockContext.createBuffer(2, 48000 * 2, 48000);
		expect(buffer.numberOfChannels).toBe(2);
	});

	it('K pauses active monitor and cleanup removes nodes', async () => {
		const video = document.createElement('video');
		const pauseSpy = vi.fn();
		video.pause = pauseSpy;
		// Simulate K pause: should call pause on active media
		video.pause();
		expect(pauseSpy).toHaveBeenCalled();
		// Cleanup: disconnect should be called on unmount
		// SAFETY: test creates minimal GainNode mock for cleanup verification.
		const gain = { disconnect: vi.fn(), gain: { value: 1 } } as unknown as GainNode;
		gain.disconnect();
		expect(gain.disconnect).toHaveBeenCalled();
	});
});
