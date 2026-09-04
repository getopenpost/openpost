import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isLottieFile, parseLottieFileBytes, parseLottieMetadata } from './metadata';

const animation = {
	v: '5.12.2',
	w: 320,
	h: 180,
	fr: 24,
	ip: 10,
	op: 58,
	layers: [],
	markers: [
		{ tm: 12, cm: 'Intro', dr: 8 },
		{ tm: 40, cm: 'Hold', dr: 0 }
	]
};

describe('Lottie metadata', () => {
	it('reads native dimensions and timing from raw animation JSON', () => {
		expect(parseLottieMetadata(animation)).toEqual({
			width: 320,
			height: 180,
			frameRate: 24,
			totalFrames: 48,
			durationSeconds: 2,
			markers: [
				{ name: 'Intro', start: 12, duration: 8 },
				{ name: 'Hold', start: 40, duration: 0 }
			]
		});
		expect(parseLottieFileBytes(strToU8(JSON.stringify(animation)))).toEqual(
			parseLottieMetadata(animation)
		);
	});

	it('rejects arbitrary JSON and corrupt archives', () => {
		expect(parseLottieMetadata({ w: 320, h: 180, fr: 30, op: 60 })).toBeNull();
		expect(parseLottieFileBytes(strToU8('PK\u0003\u0004broken'))).toBeNull();
		expect(isLottieFile({ name: 'animation.lottie', type: '' })).toBe(true);
		expect(isLottieFile({ name: 'notes.json', type: 'application/json' })).toBe(true);
		expect(isLottieFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(false);
	});
});
