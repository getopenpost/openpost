import { describe, expect, it } from 'vitest';
import {
	applyNoiseReductionSync,
	clampNoiseReductionAmount,
	isNoiseReductionActive,
	resolveNoiseReductionSettings,
	StreamingNoiseReduction
} from './audio-noise-reduction';

function sine(freq: number, frames = 48000, sr = 48000, amp = 0.5): Float32Array {
	return Float32Array.from(
		{ length: frames },
		(_, i) => Math.sin(2 * Math.PI * freq * (i / sr)) * amp
	);
}

function whiteNoise(frames: number, amp = 0.15, seed = 1): Float32Array {
	const out = new Float32Array(frames);
	let s = seed;
	for (let i = 0; i < frames; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		out[i] = ((s / 4294967296) * 2 - 1) * amp;
	}
	return out;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(a.length);
	for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
	return out;
}
function rms(a: Float32Array): number {
	return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}
function snr(clean: Float32Array, test: Float32Array): number {
	let sig = 0;
	let noise = 0;
	for (let i = 0; i < clean.length; i++) {
		const c = clean[i] ?? 0;
		const e = (test[i] ?? 0) - c;
		sig += c * c;
		noise += e * e;
	}
	return 10 * Math.log10((sig + 1e-12) / (noise + 1e-12));
}
function bandEnergy(samples: Float32Array, sr: number, lo: number, hi: number): number {
	// Simple DFT-based band energy for test: use naive correlation with sine at center
	// For our purposes, compare out-of-band noise reduction vs tone preservation via RMS of high-pass
	// High-pass via simple difference
	let e = 0;
	for (let i = 1; i < samples.length; i++) {
		const diff = (samples[i] ?? 0) - (samples[i - 1] ?? 0);
		if (hi > 4000) e += diff * diff;
	}
	return e;
}

describe('audio noise reduction - signal truth', () => {
	it('clamps amount and resolves defaults', () => {
		expect(clampNoiseReductionAmount(999)).toBe(100);
		expect(clampNoiseReductionAmount(-5)).toBe(0);
		expect(resolveNoiseReductionSettings(null).enabled).toBe(false);
		expect(
			resolveNoiseReductionSettings({
				audioNoiseReductionEnabled: true,
				audioNoiseReductionAmount: 73
			}).amount
		).toBe(73);
		expect(isNoiseReductionActive({ enabled: true, amount: 0 })).toBe(false);
		expect(isNoiseReductionActive({ enabled: true, amount: 30 })).toBe(true);
	});

	it('reduces hiss and improves SNR while preserving the tone', () => {
		const clean = sine(1000, 48000, 48000, 0.4);
		const noise = whiteNoise(48000, 0.18, 42);
		const noisy = add(clean, noise);
		const beforeSnr = snr(clean, noisy);
		const out = applyNoiseReductionSync([noisy], 48000, { enabled: true, amount: 75 });
		const afterSnr = snr(clean, out[0]!);
		expect(afterSnr).toBeGreaterThan(beforeSnr + 0.5);
		expect(rms(out[0]!)).toBeLessThan(rms(noisy));
		// The tone itself must survive: correlation with the clean sine stays high
		// while high-frequency noise energy drops.
		const sr = 48000;
		const denoised = applyNoiseReductionSync([noisy], sr, { enabled: true, amount: 60 })[0]!;
		let corr = 0;
		let e1 = 0;
		let e2 = 0;
		for (let i = 0; i < sr; i++) {
			const c = clean[i] ?? 0;
			const o = denoised[i] ?? 0;
			corr += c * o;
			e1 += c * c;
			e2 += o * o;
		}
		expect(corr / Math.sqrt(e1 * e2 + 1e-12)).toBeGreaterThan(0.85);
		expect(bandEnergy(denoised, sr, 4000, 20000)).toBeLessThan(
			bandEnergy(noisy, sr, 4000, 20000) * 0.9
		);
	});

	it('tail does not click: boundary is smooth', () => {
		const sr = 48000;
		const len = 48000;
		const sig = sine(200, len, sr, 0.5);
		const out = applyNoiseReductionSync([sig], sr, { enabled: true, amount: 50 })[0]!;
		const tail = out.slice(len - 200, len);
		let maxJump = 0;
		for (let i = 1; i < tail.length; i++)
			maxJump = Math.max(maxJump, Math.abs((tail[i] ?? 0) - (tail[i - 1] ?? 0)));
		expect(maxJump).toBeLessThan(0.02);
		const proc = new StreamingNoiseReduction(1, sr, { enabled: true, amount: 50 });
		const a = proc.process([sig.slice(0, 24000)], false)[0]!;
		const b = proc.process([sig.slice(24000)], true)[0]!;
		const chunked = new Float32Array(len);
		chunked.set(a, 0);
		chunked.set(b, a.length);
		const boundary = 24000;
		const jump = Math.abs((chunked[boundary] ?? 0) - (chunked[boundary - 1] ?? 0));
		expect(jump).toBeLessThan(0.02);
		// After final flush, queues must be zero
		const inv = proc.getQueueInvariants();
		expect(inv.inPending).toBe(0);
		expect(inv.outPending).toBe(0);
		expect(inv.overlap).toBe(0);
		expect(inv.totalInput).toBe(len);
		expect(inv.totalEmitted).toBe(len);
	});
});
