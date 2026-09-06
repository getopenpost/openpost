import { describe, expect, it } from 'vitest';
import {
	applyAudioEffectStages,
	applyPanOffline,
	createDefaultAudioEffect,
	normalizeAudioEffects,
	reorderAudioEffects,
	StreamingAudioEffectChain,
	getAudioEffectTailSeconds
} from './audio-effects';

function sine(freq: number, sampleRate = 48000, seconds = 0.4, amp = 0.5): Float32Array {
	return Float32Array.from(
		{ length: Math.round(sampleRate * seconds) },
		(_, i) => Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp
	);
}
function peak(ch: Float32Array): number {
	let p = 0;
	for (const s of ch) p = Math.max(p, Math.abs(s));
	return p;
}
function rms(ch: Float32Array): number {
	return Math.sqrt(ch.reduce((s, v) => s + v * v, 0) / ch.length);
}

describe('audio effects rack offline', () => {
	it('pan mono equal-power law -1,0,1', () => {
		const mono = sine(440, 48000, 0.1, 1);
		const left = applyPanOffline([mono.slice()], -1);
		expect(rms(left[0]!)).toBeCloseTo(0.707, 2);
		expect(peak(left[1]!)).toBeLessThan(1e-6);
		expect(peak(left[0]!)).toBeCloseTo(0.707 * Math.SQRT2, 2);
		const center = applyPanOffline([mono.slice()], 0);
		expect(rms(center[0]!)).toBeCloseTo(0.5, 2);
		expect(rms(center[1]!)).toBeCloseTo(0.5, 2);
		const right = applyPanOffline([mono.slice()], 1);
		expect(peak(right[0]!)).toBeLessThan(1e-6);
		expect(peak(right[1]!)).toBeCloseTo(1, 2);
	});

	it('channel isolation: impulse in left does not leak to right', () => {
		const len = 48000 * 0.6;
		const left = new Float32Array(len);
		const right = new Float32Array(len);
		left[100] = 1;
		const cases: Array<ReturnType<typeof createDefaultAudioEffect>> = [
			(() => {
				const c = createDefaultAudioEffect('delay');
				c.timeMs = 80;
				c.feedback = 0.3;
				c.mix = 0.5;
				return c;
			})(),
			(() => {
				const c = createDefaultAudioEffect('reverb');
				c.decaySeconds = 1;
				c.wet = 0.5;
				return c;
			})(),
			(() => {
				const c = createDefaultAudioEffect('chorus');
				c.rateHz = 1;
				c.depthMs = 4;
				return c;
			})(),
			(() => {
				const c = createDefaultAudioEffect('flanger');
				c.rateHz = 0.8;
				c.depthMs = 3;
				return c;
			})(),
			(() => {
				const c = createDefaultAudioEffect('compressor');
				c.thresholdDb = -20;
				c.ratio = 4;
				return c;
			})(),
			(() => {
				const c = createDefaultAudioEffect('distortion');
				c.amount = 0.6;
				return c;
			})()
		];
		for (const eff of cases) {
			const out = applyAudioEffectStages([left.slice(), right.slice()], 48000, [eff]);
			expect(peak(out[1]!)).toBeLessThan(1e-5);
			expect(peak(out[0]!)).toBeGreaterThan(0.01);
		}
	});

	it('deterministic modulated effects', () => {
		const src = sine(440, 48000, 0.5, 0.4);
		const chorus = createDefaultAudioEffect('chorus');
		chorus.rateHz = 1.5;
		chorus.depthMs = 6;
		const a = applyAudioEffectStages([src.slice(), src.slice()], 48000, [chorus]);
		const b = applyAudioEffectStages([src.slice(), src.slice()], 48000, [chorus]);
		expect(a[0]![1000]).toBeCloseTo(b[0]![1000], 6);
		const flanger = createDefaultAudioEffect('flanger');
		flanger.rateHz = 0.9;
		const fa = applyAudioEffectStages([src.slice(), src.slice()], 48000, [flanger]);
		const fb = applyAudioEffectStages([src.slice(), src.slice()], 48000, [flanger]);
		expect(fa[0]![2000]).toBeCloseTo(fb[0]![2000], 6);
	});

	it('tail flushing produces bounded energy after impulse', () => {
		const impulse = new Float32Array(4800);
		impulse[100] = 1;
		const delay = createDefaultAudioEffect('delay');
		delay.timeMs = 100;
		delay.feedback = 0.5;
		delay.mix = 0.7;
		const chain = new StreamingAudioEffectChain([delay], 48000, 1);
		chain.process([impulse.slice()]);
		const tail = chain.drain(48000 * 0.6);
		expect(tail[0]!.length).toBe(48000 * 0.6);
		expect(rms(tail[0]!.slice(0, 4800))).toBeGreaterThan(0.001);
		const tailSeconds = getAudioEffectTailSeconds([delay]);
		expect(tailSeconds).toBeCloseTo(0.22, 1);
	});
});
