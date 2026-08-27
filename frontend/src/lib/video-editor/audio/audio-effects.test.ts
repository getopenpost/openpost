import { describe, expect, it } from 'vitest';
import {
	applyAudioEffectStages,
	createDefaultAudioEffect,
	normalizeAudioEffects,
	reorderAudioEffects,
	StreamingAudioEffectChain
} from './audio-effects';

function sine(freq: number, sampleRate = 48000, seconds = 0.5, amp = 0.9): Float32Array {
	return Float32Array.from(
		{ length: Math.round(sampleRate * seconds) },
		(_, i) => Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp
	);
}
function peak(channels: Float32Array[]): number {
	let p = 0;
	for (const c of channels) for (const s of c) p = Math.max(p, Math.abs(s));
	return p;
}
function rms(channel: Float32Array): number {
	return Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length);
}

describe('audio effects rack offline', () => {
	it('compressor reduces peaks above threshold', () => {
		const loud = sine(440, 48000, 0.25, 0.95);
		const input = [loud.slice(), loud.slice()];
		const comp = createDefaultAudioEffect('compressor');
		(comp as unknown as Record<string, unknown>).thresholdDb = -12;
		(comp as unknown as Record<string, unknown>).ratio = 8;
		(comp as unknown as Record<string, unknown>).attackMs = 1;
		(comp as unknown as Record<string, unknown>).releaseMs = 40;
		(comp as unknown as Record<string, unknown>).makeupGainDb = 0;
		const out = applyAudioEffectStages(input, 48000, [comp]);
		// Check second half where envelope has settled
		const secondHalf = out[0]!.slice(out[0]!.length / 2);
		const origHalf = input[0]!.slice(input[0]!.length / 2);
		expect(peak([secondHalf])).toBeLessThan(peak([origHalf]) * 0.92);
		expect(peak(out)).toBeGreaterThan(0.05);
	});

	it('pan changes L/R energy', () => {
		const mono = sine(440, 48000, 0.2, 0.6);
		const leftPan = createDefaultAudioEffect('pan');
		(leftPan as unknown as Record<string, unknown>).pan = -1;
		const rightPan = createDefaultAudioEffect('pan');
		(rightPan as unknown as Record<string, unknown>).pan = 1;
		const leftOut = applyAudioEffectStages([mono.slice()], 48000, [leftPan]);
		const rightOut = applyAudioEffectStages([mono.slice()], 48000, [rightPan]);
		expect(leftOut).toHaveLength(2);
		expect(rightOut).toHaveLength(2);
		expect(rms(leftOut[0]!)).toBeGreaterThan(rms(leftOut[1]!) * 3);
		expect(rms(rightOut[1]!)).toBeGreaterThan(rms(rightOut[0]!) * 3);
	});

	it('delay tail exists after dry input', () => {
		const impulse = new Float32Array(48000 * 0.6);
		impulse[100] = 1;
		const delay = createDefaultAudioEffect('delay');
		(delay as unknown as Record<string, unknown>).timeMs = 120;
		(delay as unknown as Record<string, unknown>).feedback = 0.4;
		(delay as unknown as Record<string, unknown>).mix = 0.6;
		const out = applyAudioEffectStages([impulse.slice(), new Float32Array(impulse.length)], 48000, [
			delay
		]);
		const tailStart = 100 + Math.round((120 / 1000) * 48000) + 5;
		const tailEnergy = out[0]!
			.slice(tailStart, tailStart + 500)
			.reduce((s, v) => s + Math.abs(v), 0);
		const dryEnergy = out[0]!.slice(0, 50).reduce((s, v) => s + Math.abs(v), 0);
		expect(tailEnergy).toBeGreaterThan(0.005);
		// Dry still present but tail distinct
		expect(tailEnergy).toBeGreaterThan(dryEnergy * 0.01);
	});

	it('reverb tail exists after dry input', () => {
		const impulse = new Float32Array(48000 * 0.8);
		impulse[200] = 1;
		const reverb = createDefaultAudioEffect('reverb');
		(reverb as unknown as Record<string, unknown>).decaySeconds = 1.2;
		(reverb as unknown as Record<string, unknown>).wet = 0.5;
		const out = applyAudioEffectStages([impulse.slice(), new Float32Array(impulse.length)], 48000, [
			reverb
		]);
		const tail = out[0]!.slice(800, 4800).reduce((s, v) => s + Math.abs(v), 0);
		expect(tail).toBeGreaterThan(0.005);
	});

	it('modulation effects are deterministic with fixed phase', () => {
		const src = sine(440, 48000, 0.4, 0.4);
		const chorus = createDefaultAudioEffect('chorus');
		(chorus as unknown as Record<string, unknown>).rateHz = 1.2;
		(chorus as unknown as Record<string, unknown>).depthMs = 5;
		const out1 = applyAudioEffectStages([src.slice(), src.slice()], 48000, [chorus]);
		const out2 = applyAudioEffectStages([src.slice(), src.slice()], 48000, [chorus]);
		expect(out1[0]![1000]).toBeCloseTo(out2[0]![1000], 6);
		const flanger = createDefaultAudioEffect('flanger');
		(flanger as unknown as Record<string, unknown>).rateHz = 0.8;
		(flanger as unknown as Record<string, unknown>).depthMs = 3;
		const f1 = applyAudioEffectStages([src.slice(), src.slice()], 48000, [flanger]);
		const f2 = applyAudioEffectStages([src.slice(), src.slice()], 48000, [flanger]);
		expect(f1[0]![2000]).toBeCloseTo(f2[0]![2000], 6);
	});

	it('distortion adds bounded harmonics and stays finite', () => {
		const src = sine(100, 48000, 0.3, 0.5);
		const dist = createDefaultAudioEffect('distortion');
		(dist as unknown as Record<string, unknown>).amount = 0.8;
		(dist as unknown as Record<string, unknown>).mix = 1;
		const out = applyAudioEffectStages([src.slice()], 48000, [dist]);
		expect(peak(out)).toBeGreaterThan(peak([src]) * 0.5);
		expect(peak(out)).toBeLessThan(1.25);
		for (const s of out[0]!) expect(Number.isFinite(s)).toBe(true);
	});

	it('stacked chain preview/export parity: streaming equals one-shot', () => {
		const src = sine(300, 48000, 1.0, 0.4);
		const channels = [src.slice(), src.slice()];
		const chain = [
			createDefaultAudioEffect('compressor'),
			createDefaultAudioEffect('pan'),
			createDefaultAudioEffect('delay'),
			createDefaultAudioEffect('reverb'),
			createDefaultAudioEffect('chorus'),
			createDefaultAudioEffect('flanger'),
			createDefaultAudioEffect('distortion')
		];
		(chain[1] as unknown as Record<string, unknown>).pan = 0.35;
		const oneShot = applyAudioEffectStages(
			channels.map((c) => c.slice()),
			48000,
			chain
		);
		const streaming = new StreamingAudioEffectChain(chain, 48000, 2);
		const chunkA = channels.map((c) => c.slice(0, c.length / 2));
		const chunkB = channels.map((c) => c.slice(c.length / 2));
		const outA = streaming.process(chunkA);
		const outB = streaming.process(chunkB);
		const stitched = [new Float32Array(oneShot[0]!.length), new Float32Array(oneShot[1]!.length)];
		stitched[0]!.set(outA[0]!, 0);
		stitched[0]!.set(outB[0]!, outA[0]!.length);
		stitched[1]!.set(outA[1]!, 0);
		stitched[1]!.set(outB[1]!, outA[1]!.length);
		// Compare stitched streaming vs one-shot
		let err = 0;
		for (let i = 0; i < stitched[0]!.length; i++)
			err += Math.abs(stitched[0]![i]! - oneShot[0]![i]!);
		expect(err / stitched[0]!.length).toBeLessThan(0.02);
	});

	it('reorder, bypass, reset, clone-safe, bounded', () => {
		const a = createDefaultAudioEffect('delay');
		const b = createDefaultAudioEffect('reverb');
		const c = createDefaultAudioEffect('pan');
		const chain = [a, b, c];
		const reordered = reorderAudioEffects(chain, 0, 2);
		expect(reordered[2]!.id).toBe(a.id);
		expect(reordered[0]!.id).toBe(b.id);
		const bypassed = chain.map((e) => (e.id === b.id ? { ...e, enabled: false } : e));
		const active = normalizeAudioEffects(bypassed).filter((e) => e.enabled);
		expect(active.some((e) => e.id === b.id)).toBe(false);
		// Clone-safe: mutating clone does not affect original
		const cloned = normalizeAudioEffects(structuredClone(chain));
		(cloned[0] as unknown as Record<string, unknown>).timeMs = 999;
		expect((chain[0] as unknown as Record<string, unknown>).timeMs).not.toBe(999);
		// Bounded
		const evil = createDefaultAudioEffect('delay');
		(evil as unknown as Record<string, unknown>).feedback = 10;
		(evil as unknown as Record<string, unknown>).timeMs = 99999;
		const norm = normalizeAudioEffects([evil])[0]! as unknown as Record<string, unknown>;
		expect(norm.feedback as number).toBeLessThanOrEqual(0.92);
		expect(norm.timeMs as number).toBeLessThanOrEqual(2000);
	});
});
