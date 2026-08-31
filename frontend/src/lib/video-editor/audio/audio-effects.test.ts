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

	it('pan stereo balance', () => {
		const left = new Float32Array(4800).fill(0.6);
		const right = new Float32Array(4800).fill(0.6);
		const lPan = applyPanOffline([left.slice(), right.slice()], -1);
		expect(rms(lPan[0]!)).toBeCloseTo(0.6, 2);
		expect(rms(lPan[1]!)).toBeLessThan(0.01);
		const rPan = applyPanOffline([left.slice(), right.slice()], 1);
		expect(rms(rPan[1]!)).toBeCloseTo(0.6, 2);
		expect(rms(rPan[0]!)).toBeLessThan(0.01);
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

	it('chunk-boundary equivalence for stacked chain', () => {
		const src = sine(300, 48000, 0.8, 0.4);
		const chain = [
			createDefaultAudioEffect('compressor'),
			createDefaultAudioEffect('delay'),
			createDefaultAudioEffect('reverb'),
			createDefaultAudioEffect('chorus')
		];
		{
			const effect = chain[1];
			if (effect?.type === 'delay') effect.timeMs = 120;
		}
		const oneShot = applyAudioEffectStages([src.slice(), src.slice()], 48000, chain);
		const streaming = new StreamingAudioEffectChain(chain, 48000, 2);
		const a = [src.slice(0, src.length / 2), src.slice(0, src.length / 2)];
		const b = [src.slice(src.length / 2), src.slice(src.length / 2)];
		const outA = streaming.process(a);
		const outB = streaming.process(b);
		const stitched0 = new Float32Array(src.length);
		stitched0.set(outA[0]!, 0);
		stitched0.set(outB[0]!, outA[0]!.length);
		let err = 0;
		for (let i = 0; i < stitched0.length; i++) err += Math.abs(stitched0[i]! - oneShot[0]![i]!);
		expect(err / stitched0.length).toBeLessThan(0.015);
	});

	it('delay highCut/lowCut parameter response', () => {
		const highSine = sine(6000, 48000, 0.3, 0.5);
		const low = createDefaultAudioEffect('delay');
		low.timeMs = 40;
		low.feedback = 0.4;
		low.mix = 1;
		low.lowCutHz = 20;
		low.highCutHz = 900;
		const high = createDefaultAudioEffect('delay');
		high.timeMs = 40;
		high.feedback = 0.4;
		high.mix = 1;
		high.lowCutHz = 20;
		high.highCutHz = 12000;
		const outLow = applyAudioEffectStages([highSine.slice()], 48000, [low]);
		const outHigh = applyAudioEffectStages([highSine.slice()], 48000, [high]);
		const tailStart = Math.round((40 / 1000) * 48000) + 5;
		const rmsLow = rms(outLow[0]!.slice(tailStart, tailStart + 4000));
		const rmsHigh = rms(outHigh[0]!.slice(tailStart, tailStart + 4000));
		expect(rmsHigh).toBeGreaterThan(rmsLow * 1.5);
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

	it('distortion bounded and reverb deterministic', () => {
		const src = sine(100, 48000, 0.2, 0.5);
		const dist = createDefaultAudioEffect('distortion');
		dist.amount = 0.9;
		dist.mix = 1;
		const out = applyAudioEffectStages([src.slice()], 48000, [dist]);
		expect(peak(out[0]!)).toBeLessThan(1.2);
		expect(peak(out[0]!)).toBeGreaterThan(0.3);
		const impulse = new Float32Array(48000 * 0.8);
		impulse[200] = 1;
		const rev = createDefaultAudioEffect('reverb');
		rev.decaySeconds = 1.2;
		rev.wet = 0.5;
		const r1 = applyAudioEffectStages([impulse.slice()], 48000, [rev]);
		const r2 = applyAudioEffectStages([impulse.slice()], 48000, [rev]);
		expect(r1[0]![1000]).toBeCloseTo(r2[0]![1000], 6);
		expect(rms(r1[0]!.slice(500, 3000))).toBeGreaterThan(0.001);
	});
});
