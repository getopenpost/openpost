import { describe, expect, it } from 'vitest';
import {
	hueAmountFromWheelChannels,
	wheelChannelsFromHueAmount,
	type WheelChannels
} from './wheel-channels';

describe('color wheel channels', () => {
	it.each([
		[0, 0.5],
		[60, 0.25],
		[145, 0.8],
		[240, 1],
		[315, 0.65]
	])('round trips %s degrees at %s amount', (hue, amount) => {
		const restored = hueAmountFromWheelChannels(wheelChannelsFromHueAmount(hue, amount));
		expect(restored.hue).toBeCloseTo(hue, 6);
		expect(restored.amount).toBeCloseTo(amount, 6);
	});

	it('discards a uniform master offset when restoring the wheel push', () => {
		const base = wheelChannelsFromHueAmount(210, 0.4);
		const channels: WheelChannels = [base[0] + 1.25, base[1] + 1.25, base[2] + 1.25];
		const restored = hueAmountFromWheelChannels(channels);
		expect(restored.hue).toBeCloseTo(210, 6);
		expect(restored.amount).toBeCloseTo(0.4, 6);
	});
});
