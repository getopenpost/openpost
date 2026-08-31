export type WheelChannels = [number, number, number];

export interface WheelPosition {
	hue: number;
	amount: number;
}

function wheelHueToTint(hue: number): WheelChannels {
	const normalized = (((hue % 360) + 360) % 360) / 60;
	const cross = 1 - Math.abs((normalized % 2) - 1);
	if (normalized < 1) return [1, cross, 0];
	if (normalized < 2) return [cross, 1, 0];
	if (normalized < 3) return [0, 1, cross];
	if (normalized < 4) return [0, cross, 1];
	if (normalized < 5) return [cross, 0, 1];
	return [1, 0, cross];
}

/** Convert a wheel push to Resolve-style mean-centered red, green, and blue channels. */
export function wheelChannelsFromHueAmount(hue: number, amount: number): WheelChannels {
	const tint = wheelHueToTint(hue);
	const deviations: WheelChannels = [
		amount * (tint[0] - 1),
		amount * (tint[1] - 1),
		amount * (tint[2] - 1)
	];
	const mean = (deviations[0] + deviations[1] + deviations[2]) / 3;
	return [deviations[0] - mean, deviations[1] - mean, deviations[2] - mean];
}

/** Project edited channel values back onto the wheel's reachable hue and amount state. */
export function hueAmountFromWheelChannels(channels: WheelChannels): WheelPosition {
	const maximum = Math.max(channels[0], channels[1], channels[2]);
	const red = channels[0] - maximum;
	const green = channels[1] - maximum;
	const blue = channels[2] - maximum;
	const amount = -Math.min(red, green, blue);
	if (amount < 0.0001) return { hue: 0, amount: 0 };

	const tintRed = 1 + red / amount;
	const tintGreen = 1 + green / amount;
	const tintBlue = 1 + blue / amount;
	let hue: number;
	if (tintRed >= tintGreen && tintRed >= tintBlue) {
		hue = ((tintGreen - tintBlue) % 6) * 60;
	} else if (tintGreen >= tintRed && tintGreen >= tintBlue) {
		hue = (tintBlue - tintRed + 2) * 60;
	} else {
		hue = (tintRed - tintGreen + 4) * 60;
	}
	if (hue < 0) hue += 360;
	return { hue, amount: Math.min(1, amount) };
}
