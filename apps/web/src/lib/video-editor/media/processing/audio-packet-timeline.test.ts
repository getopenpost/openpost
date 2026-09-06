// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { clampPacketToTimeline, type TimedPacket } from './audio-packet-timeline';

type FakePacket = TimedPacket<FakePacket>;

function packet(timestamp: number, duration: number): FakePacket {
	return {
		timestamp,
		duration,
		clone: ({ timestamp: t, duration: d }) => packet(t, d)
	};
}

/** One AAC frame at 44.1kHz — exactly the priming offset a real encoder emits. */
const AAC_FRAME = 1024 / 44_100;

describe('clampPacketToTimeline', () => {
	it('drops the AAC priming packet, which ends exactly at zero', () => {
		expect(clampPacketToTimeline(packet(-AAC_FRAME, AAC_FRAME))).toBeNull();
	});

	it('trims a packet that straddles zero, keeping only the audible tail', () => {
		const clamped = clampPacketToTimeline(packet(-0.01, 0.03));
		expect(clamped).not.toBeNull();
		expect(clamped!.timestamp).toBe(0);
		expect(clamped!.duration).toBeCloseTo(0.02, 6);
	});

	it('never emits a negative timestamp for any input', () => {
		const inputs = [
			packet(-AAC_FRAME, AAC_FRAME),
			packet(-0.05, 0.06),
			packet(-1e-9, 0.02),
			packet(0, 0.02),
			packet(1.5, 0.02)
		];
		for (const p of inputs) {
			const result = clampPacketToTimeline(p);
			if (result !== null) expect(result.timestamp).toBeGreaterThanOrEqual(0);
		}
	});
});
