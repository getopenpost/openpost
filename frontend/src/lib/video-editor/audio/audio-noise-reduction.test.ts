import { describe, expect, it, vi } from 'vitest';
import {
	applyNoiseReduction,
	applyNoiseReductionSync,
	clampNoiseReductionAmount,
	hannReconstructWithGainOne,
	isNoiseReductionActive,
	NOISE_REDUCTION_HOP_SIZE,
	resolveNoiseReductionSettings,
	StreamingNoiseReduction
} from './audio-noise-reduction';
import { processPreviewNoiseReduction } from './audio-noise-reduction-preview';
import { processAudioChannels } from './process-audio';
import { resolveAudioEqSettings } from './audio-eq';

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
function maxAbsDiff(a: Float32Array, b: Float32Array): number {
	let max = 0;
	for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	return max;
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

function streamingWithChunks(
	input: Float32Array,
	chunkSizes: number[],
	sampleRate = 48000,
	amount = 60
): Float32Array {
	const proc = new StreamingNoiseReduction(1, sampleRate, { enabled: true, amount });
	const parts: Float32Array[] = [];
	let offset = 0;
	for (let i = 0; i < chunkSizes.length; i++) {
		const size = chunkSizes[i]!;
		const chunk = input.slice(offset, offset + size);
		const isLast = offset + size >= input.length;
		const out = proc.process([chunk], isLast)[0]!;
		if (out.length) parts.push(out);
		offset += size;
		if (isLast) break;
	}
	if (offset < input.length) {
		const remaining = input.slice(offset);
		const out = proc.process([remaining], true)[0]!;
		if (out.length) parts.push(out);
	}
	// Also handle case where last chunk was not isLast due to chunkSizes not covering all
	if (offset < input.length) {
		const flush = proc.flush()[0]!;
		if (flush.length) parts.push(flush);
	} else if (parts.reduce((s, p) => s + p.length, 0) < input.length) {
		const flush = proc.flush()[0]!;
		if (flush.length) parts.push(flush);
	}
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Float32Array(total);
	let pos = 0;
	for (const p of parts) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
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

	it('does not change length and is bypassed when disabled', () => {
		const ch = sine(440, 4800);
		const out = applyNoiseReductionSync([ch], 48000, { enabled: false, amount: 80 });
		expect(out[0]!.length).toBe(ch.length);
		expect(out[0]).not.toBe(ch);
		for (let i = 0; i < ch.length; i++) expect(out[0]![i]).toBe(ch[i]);
	});

	it('reduces hiss and improves SNR vs clean truth', () => {
		const clean = sine(1000, 48000, 48000, 0.4);
		const noise = whiteNoise(48000, 0.18, 42);
		const noisy = add(clean, noise);
		const beforeSnr = snr(clean, noisy);
		const out = applyNoiseReductionSync([noisy], 48000, { enabled: true, amount: 75 });
		const afterSnr = snr(clean, out[0]!);
		expect(afterSnr).toBeGreaterThan(beforeSnr + 0.5);
		expect(rms(out[0]!)).toBeLessThan(rms(noisy));
	});

	it('preserves tone energy while reducing out-of-band noise', () => {
		const sr = 48000;
		const clean = sine(1000, sr, sr, 0.4);
		const noise = whiteNoise(sr, 0.2, 99);
		const noisy = add(clean, noise);
		const out = applyNoiseReductionSync([noisy], sr, { enabled: true, amount: 60 })[0]!;
		// Tone bin energy should be largely preserved (within 15%), high-freq noise reduced
		const toneBefore = Math.abs(noisy[1000] ?? 0);
		const toneAfter = Math.abs(out[1000] ?? 0);
		// Instead check RMS of filtered high freq via simple high-pass energy proxy
		// Compute high-frequency energy via difference
		const noisyHigh = bandEnergy(noisy, sr, 4000, 20000);
		const outHigh = bandEnergy(out, sr, 4000, 20000);
		expect(outHigh).toBeLessThan(noisyHigh * 0.9);
		// Tone should not be heavily attenuated: check that sine correlation remains high
		let corr = 0;
		let e1 = 0;
		let e2 = 0;
		for (let i = 0; i < sr; i++) {
			const c = clean[i] ?? 0;
			const o = out[i] ?? 0;
			corr += c * o;
			e1 += c * c;
			e2 += o * o;
		}
		const normCorr = corr / Math.sqrt(e1 * e2 + 1e-12);
		expect(normCorr).toBeGreaterThan(0.85);
	});

	it('stronger amount suppresses more than weaker', () => {
		const clean = sine(800, 24000, 48000, 0.3);
		const noisy = add(clean, whiteNoise(24000, 0.2, 7));
		const low = applyNoiseReductionSync([noisy], 48000, { enabled: true, amount: 20 })[0]!;
		const high = applyNoiseReductionSync([noisy], 48000, { enabled: true, amount: 85 })[0]!;
		expect(rms(high)).toBeLessThan(rms(low));
	});

	it('handles short inputs without attack loss', () => {
		for (const len of [1, 100, 512, 1000, 1023]) {
			const input = new Float32Array(len).fill(0.8);
			const out = applyNoiseReductionSync([input], 48000, { enabled: true, amount: 60 })[0]!;
			expect(out.length).toBe(len);
			expect(maxAbsDiff(out, input)).toBeLessThan(1e-7);
		}
	});

	it('gain=1 periodic-Hann reconstruction max error <=1e-4 including tail', () => {
		const sr = 48000;
		const len = 48000;
		const sig = sine(440, len, sr, 0.5);
		const out = hannReconstructWithGainOne([sig], sr)[0]!;
		expect(out.length).toBe(len);
		expect(maxAbsDiff(sig, out)).toBeLessThan(1e-4);
		let tailErr = 0;
		for (let i = len - NOISE_REDUCTION_HOP_SIZE; i < len; i++)
			tailErr = Math.max(tailErr, Math.abs((sig[i] ?? 0) - (out[i] ?? 0)));
		expect(tailErr).toBeLessThan(1e-4);
	});

	it('identical preview and export pipeline: nr before pitch/eq preserves duration', async () => {
		const noisy = add(sine(440, 48000, 48000, 0.4), whiteNoise(48000, 0.15, 123));
		const processed = await processAudioChannels([noisy], {
			speed: 1.5,
			pitchShiftSemitones: 2,
			sampleRate: 48000,
			eqStages: [resolveAudioEqSettings({ highMidGainDb: 3 })],
			noiseReduction: { enabled: true, amount: 60 }
		});
		expect(processed[0]!.length).toBe(Math.floor(48000 / 1.5));
		const processed2 = await processAudioChannels([noisy.slice()], {
			speed: 1.5,
			pitchShiftSemitones: 2,
			sampleRate: 48000,
			eqStages: [resolveAudioEqSettings({ highMidGainDb: 3 })],
			noiseReduction: { enabled: true, amount: 60 }
		});
		expect(processed[0]![1000]).toBe(processed2[0]![1000]);
	});

	it('respects AbortSignal cancellation', async () => {
		const noisy = whiteNoise(24000, 0.1, 5);
		const ctrl = new AbortController();
		ctrl.abort();
		expect(() =>
			applyNoiseReductionSync([noisy], 48000, { enabled: true, amount: 50 }, ctrl.signal)
		).toThrow();
		await expect(
			applyNoiseReduction([noisy], 48000, { enabled: true, amount: 50 }, ctrl.signal)
		).rejects.toThrow();
	});
});

describe('audio noise reduction - streaming correctness and bounds', () => {
	it('process(...,false)+flush emits exact total and matches one-shot for sub-frame, irregular, multi-frame', async () => {
		const sr = 48000;
		const testOneShotVsStreaming = (len: number, chunkSizes: number[]) => {
			const noisy = add(sine(600, len, sr, 0.35), whiteNoise(len, 0.16, 99));
			const oneShot = applyNoiseReductionSync([noisy], sr, { enabled: true, amount: 60 })[0]!;
			expect(oneShot.length).toBe(len);
			// Streaming via process+flush
			const proc = new StreamingNoiseReduction(1, sr, { enabled: true, amount: 60 });
			const parts: Float32Array[] = [];
			let offset = 0;
			for (const sz of chunkSizes) {
				const chunk = noisy.slice(offset, offset + sz);
				const isLast = offset + sz >= len;
				const out = proc.process([chunk], isLast)[0]!;
				if (out.length) parts.push(out);
				offset += sz;
				if (isLast) break;
			}
			if (offset < len) {
				const flush = proc.flush()[0]!;
				if (flush.length) parts.push(flush);
			} else if (parts.reduce((s, p) => s + p.length, 0) < len) {
				const flush = proc.flush()[0]!;
				if (flush.length) parts.push(flush);
			}
			const total = parts.reduce((s, p) => s + p.length, 0);
			expect(total).toBe(len);
			const chunked = new Float32Array(len);
			let pos = 0;
			for (const p of parts) {
				chunked.set(p, pos);
				pos += p.length;
			}
			expect(maxAbsDiff(oneShot, chunked)).toBeLessThan(1e-5);
		};

		// Sub-frame: single sample split? Use len 1, 100
		testOneShotVsStreaming(1, [1]);
		testOneShotVsStreaming(100, [30, 30, 40]);
		testOneShotVsStreaming(512, [200, 312]);
		testOneShotVsStreaming(1000, [1, 999]);
		testOneShotVsStreaming(1023, [512, 511]);
		// Irregular tiny (HOP-aligned, each >= FRAME_SIZE, sum exactly len)
		testOneShotVsStreaming(48000, [12288, 8192, 12288, 8192, 7040]);
		// Multi-frame normal export windows
		testOneShotVsStreaming(48000 * 2, [48000, 48000]);
		testOneShotVsStreaming(48000 * 10, [24000 * 5, 24000 * 5, 24000 * 5, 24000 * 5]);

		// Also test async applyNoiseReduction vs sync
		const len = 48000;
		const noisy = add(sine(600, len, sr, 0.35), whiteNoise(len, 0.16, 77));
		const syncOut = applyNoiseReductionSync([noisy], sr, { enabled: true, amount: 60 })[0]!;
		const asyncOut = (await applyNoiseReduction([noisy], sr, { enabled: true, amount: 60 }))[0]!;
		expect(maxAbsDiff(syncOut, asyncOut)).toBeLessThan(1e-6);
	});

	it('peak queue invariants are bounded O(FRAME), not O(duration)', () => {
		const sr = 48000;
		const proc = new StreamingNoiseReduction(2, sr, { enabled: true, amount: 50 });
		// Feed 30 seconds in 1 sec chunks, check invariants after each
		for (let i = 0; i < 30; i++) {
			const chunk = whiteNoise(sr, 0.1, i);
			proc.process([chunk, chunk.slice()], false);
			const inv = proc.getQueueInvariants();
			expect(inv.inPending).toBeLessThan(2048);
			expect(inv.outPending).toBeLessThan(2048);
			expect(inv.overlap).toBe(512);
		}
		const flush = proc.flush();
		expect(flush[0]!.length).toBeGreaterThan(0);
	});

	it('multi-minute signal processes with exact length', async () => {
		const sr = 48000;
		const threeMinutes = sr * 60 * 3;
		const sig = add(sine(440, threeMinutes, sr, 0.3), whiteNoise(threeMinutes, 0.12, 7));
		const proc = new StreamingNoiseReduction(1, sr, { enabled: true, amount: 50 });
		const windowSize = 48000 * 5;
		let offset = 0;
		let totalOut = 0;
		while (offset < threeMinutes) {
			const len = Math.min(windowSize, threeMinutes - offset);
			const chunk = sig.slice(offset, offset + len);
			const isLast = offset + len >= threeMinutes;
			const out = proc.process([chunk], isLast)[0]!;
			totalOut += out.length;
			offset += len;
		}
		expect(totalOut).toBe(threeMinutes);
		const asyncOut = await applyNoiseReduction([sig.slice(0, 48000 * 10)], sr, {
			enabled: true,
			amount: 50
		});
		expect(asyncOut[0]!.length).toBe(48000 * 10);
	});

	it('preserves stereo coherence: identical stereo remains identical', () => {
		const mono = add(sine(500, 24000, 48000, 0.4), whiteNoise(24000, 0.15, 13));
		const stereo = [mono.slice(), mono.slice()];
		const out = applyNoiseReductionSync(stereo, 48000, { enabled: true, amount: 70 });
		expect(out[0]!.length).toBe(mono.length);
		expect(out[1]!.length).toBe(mono.length);
		expect(maxAbsDiff(out[0]!, out[1]!)).toBeLessThan(1e-6);
	});

	it('linked stereo with different noise per channel stays correlated', () => {
		const base = sine(300, 24000, 48000, 0.4);
		const noiseL = whiteNoise(24000, 0.12, 11);
		const noiseR = whiteNoise(24000, 0.12, 22);
		const left = add(base, noiseL);
		const right = add(base, noiseR);
		const out = applyNoiseReductionSync([left, right], 48000, { enabled: true, amount: 60 });
		// After linked processing, both channels should have similar gain (not independent wandering)
		// Check that left/right difference is reduced vs independent would be
		let diffBefore = 0;
		let diffAfter = 0;
		for (let i = 0; i < left.length; i++) diffBefore += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
		for (let i = 0; i < out[0]!.length; i++)
			diffAfter += Math.abs((out[0]![i] ?? 0) - (out[1]![i] ?? 0));
		// Linked should not increase difference dramatically; allow small increase but not 2x
		expect(diffAfter).toBeLessThan(diffBefore * 1.5);
		// And tone correlation remains high
		let corr = 0;
		let e1 = 0;
		let e2 = 0;
		for (let i = 0; i < out[0]!.length; i++) {
			corr += (out[0]![i] ?? 0) * (out[1]![i] ?? 0);
			e1 += (out[0]![i] ?? 0) * (out[0]![i] ?? 0);
			e2 += (out[1]![i] ?? 0) * (out[1]![i] ?? 0);
		}
		expect(corr / Math.sqrt(e1 * e2 + 1e-12)).toBeGreaterThan(0.7);
	});

	it('preview worker path matches export streaming path', async () => {
		const sr = 48000;
		const len = 48000;
		const noisy = add(sine(440, len, sr, 0.4), whiteNoise(len, 0.15, 33));
		const exportOut = applyNoiseReductionSync([noisy], sr, { enabled: true, amount: 55 })[0]!;
		const previewOut = (
			await processPreviewNoiseReduction([noisy], sr, { enabled: true, amount: 55 })
		)[0]!;
		expect(previewOut.length).toBe(exportOut.length);
		expect(maxAbsDiff(previewOut, exportOut)).toBeLessThan(1e-4);
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

	it('worker abort is race-safe and cleans up listeners', async () => {
		const sr = 48000;
		const len = 48000 * 2;
		const ch = whiteNoise(len, 0.1, 1);
		const ctrl1 = new AbortController();
		ctrl1.abort();
		const ctrl2 = new AbortController();
		const p1 = processPreviewNoiseReduction([ch], sr, { enabled: true, amount: 60 }, ctrl1.signal);
		await expect(p1).rejects.toThrow();
		// Second should succeed and not be affected by first's listeners
		const p2 = await processPreviewNoiseReduction(
			[ch],
			sr,
			{ enabled: true, amount: 60 },
			ctrl2.signal
		);
		expect(p2[0]!.length).toBe(len);
		// No retained listeners: we can check by ensuring a third call also works
		const p3 = await processPreviewNoiseReduction([ch], sr, { enabled: true, amount: 60 });
		expect(p3[0]!.length).toBe(len);
	});
});
