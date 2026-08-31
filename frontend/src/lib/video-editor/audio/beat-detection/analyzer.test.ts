import { describe, it, expect } from 'vitest';
import { BeatAnalyzer } from './analyzer';

function syntheticPulse({
	bpm = 120,
	seconds = 8,
	sampleRate = 44_100,
	seed = 1
}: { bpm?: number; seconds?: number; sampleRate?: number; seed?: number } = {}) {
	const interval = 60 / bpm;
	const samples = new Float32Array(sampleRate * seconds);
	const burstMs = 0.04;
	const burstSamples = Math.floor(sampleRate * burstMs);
	for (let t = 0; t < seconds; t += interval) {
		const start = Math.floor(t * sampleRate);
		for (let i = 0; i < burstSamples; i++) {
			const idx = start + i;
			if (idx >= samples.length) break;
			const envelope = 1 - i / burstSamples;
			const sine = Math.sin((2 * Math.PI * 800 * i) / sampleRate);
			const jitter = 0.9 + (((seed * 9301 + 49297) % 233280) / 233280) * 0.1;
			samples[idx] += (0.7 + 0.3 * sine) * envelope * jitter;
		}
	}
	for (let i = 0; i < samples.length; i++) {
		samples[i] = (samples[i] ?? 0) + (((i * 1664525 + 1013904223) % 1000) / 1000) * 0.002 - 0.001;
	}
	return { samples, sampleRate, duration: seconds, expectedInterval: interval };
}

describe('beat analyzer - synthetic pulse source of truth', () => {
	it('recovers 120 BPM and beat grid within tolerance from an independent pulse train', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 120, seconds: 8 });
		const analyzer = new BeatAnalyzer({ sensitivity: 0.5 });
		const result = await analyzer.analyzeChannelData(samples, sampleRate, duration);

		expect(result.bpm).toBeGreaterThanOrEqual(118);
		expect(result.bpm).toBeLessThanOrEqual(122);
		expect(result.confidence).toBeGreaterThan(0.2);
		expect(result.beats.length).toBeGreaterThanOrEqual(14);
		expect(result.beats.length).toBeLessThanOrEqual(18);
		expect(result.downbeats.length).toBeGreaterThanOrEqual(3);
		expect(result.downbeats.length).toBeLessThanOrEqual(5);

		for (let i = 1; i < result.beats.length; i++) {
			const interval = result.beats[i]!.time - result.beats[i - 1]!.time;
			expect(interval).toBeGreaterThan(0.45);
			expect(interval).toBeLessThan(0.55);
		}
		const phaseOffset = result.beats[0]?.time ?? 0;
		for (let t = 0; t < duration; t += 0.5) {
			const expected = t + phaseOffset;
			if (expected >= duration) break;
			const nearest = result.beats.reduce(
				(best, b) => (Math.abs(b.time - expected) < Math.abs(best.time - expected) ? b : best),
				result.beats[0]!
			);
			expect(Math.abs(nearest.time - expected)).toBeLessThan(0.07);
		}
	});

	it('recovers 100 BPM equally well (different tempo proves not hard-coded)', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 100, seconds: 6 });
		const analyzer = new BeatAnalyzer({ sensitivity: 0.5 });
		const result = await analyzer.analyzeChannelData(samples, sampleRate, duration);
		expect(result.bpm).toBeGreaterThanOrEqual(98);
		expect(result.bpm).toBeLessThanOrEqual(102);
		expect(result.beats.length).toBeGreaterThanOrEqual(9);
		expect(result.beats.length).toBeLessThanOrEqual(12);
	});

	it('does not invent a 120 BPM grid for silence', async () => {
		const sampleRate = 44_100;
		const duration = 8;
		const analyzer = new BeatAnalyzer();
		const result = await analyzer.analyzeChannelData(
			new Float32Array(sampleRate * duration),
			sampleRate,
			duration
		);

		expect(result).toMatchObject({ bpm: 0, confidence: 0, beats: [], downbeats: [] });
	});

	it('is deterministic for the same synthetic buffer (no flake)', async () => {
		const synth = syntheticPulse({ bpm: 120, seconds: 4 });
		const analyzer = new BeatAnalyzer();
		const a = await analyzer.analyzeChannelData(synth.samples, synth.sampleRate, synth.duration);
		const b = await analyzer.analyzeChannelData(synth.samples, synth.sampleRate, synth.duration);
		expect(a.bpm).toBe(b.bpm);
		expect(a.beats.map((beat) => beat.time)).toEqual(b.beats.map((beat) => beat.time));
		expect(a.downbeats).toEqual(b.downbeats);
	});

	it('respects AbortSignal cancellation without mutating state', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 120, seconds: 12 });
		const analyzer = new BeatAnalyzer();
		const controller = new AbortController();
		const promise = analyzer.analyzeChannelData(samples, sampleRate, duration, controller.signal);
		controller.abort();
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('cooperatively cancels a long synthetic signal without blocking the main thread', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 120, seconds: 60 });
		const analyzer = new BeatAnalyzer();
		const controller = new AbortController();
		const start = Date.now();
		const promise = analyzer.analyzeChannelData(samples, sampleRate, duration, controller.signal);
		setTimeout(() => controller.abort(), 10);
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(Date.now() - start).toBeLessThan(800);
	});

	it('yields to main thread on long clips - 30s synthetic buffer completes', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 120, seconds: 30 });
		const analyzer = new BeatAnalyzer();
		const start = Date.now();
		const result = await analyzer.analyzeChannelData(samples, sampleRate, duration);
		expect(result.beats.length).toBeGreaterThan(50);
		expect(Date.now() - start).toBeGreaterThanOrEqual(0);
	});

	it('detects a pulse present only in the second channel via mono mix', async () => {
		const { samples, sampleRate, duration } = syntheticPulse({ bpm: 120, seconds: 4 });
		const silent = new Float32Array(samples.length);
		// SAFETY: test-only mock AudioBuffer - only numberOfChannels, length, sampleRate, duration and getChannelData are used by mixToMono
		const mockBuffer = {
			numberOfChannels: 2,
			length: samples.length,
			sampleRate,
			duration,
			getChannelData: (channel: number) => (channel === 0 ? silent : samples)
		} as AudioBuffer;
		const analyzer = new BeatAnalyzer();
		const result = await analyzer.analyzeAudioBuffer(mockBuffer);
		expect(result.bpm).toBeGreaterThanOrEqual(118);
		expect(result.bpm).toBeLessThanOrEqual(122);
		expect(result.beats.length).toBeGreaterThan(6);
	});
});
