import { applyLottieColorOverrides } from './color';
import {
	extractLottieAnimation,
	extractLottieThemeData,
	type LottieManifestInfo,
	extractLottieManifest
} from './metadata';
import type { LottieSlotValue } from './slots';
import { applyLottieTextOverrides } from './text';

export interface LottieRenderInput {
	animationId?: string;
	themeId?: string;
	textOverrides?: Record<string, string>;
	colorOverrides?: Record<string, string>;
	slotOverrides?: Record<string, LottieSlotValue>;
}

export interface LottieRenderSpec {
	data: string | null;
	themeData: string | null;
	slots: Record<string, LottieSlotValue> | null;
	signature: string;
}

export function lottieRenderSignature(input: LottieRenderInput): string {
	return JSON.stringify([
		input.animationId ?? null,
		input.themeId ?? null,
		input.textOverrides ?? null,
		input.colorOverrides ?? null,
		input.slotOverrides ?? null
	]);
}

export function inspectLottieArchive(bytes: Uint8Array): LottieManifestInfo | null {
	return extractLottieManifest(bytes);
}

export function resolveLottieRenderSpec(
	bytes: Uint8Array,
	input: LottieRenderInput
): LottieRenderSpec {
	const hasText = !!input.textOverrides && Object.keys(input.textOverrides).length > 0;
	const hasColor = !!input.colorOverrides && Object.keys(input.colorOverrides).length > 0;
	const needsData = hasText || hasColor || !!input.animationId;
	let data: string | null = null;
	if (needsData) {
		const animation = extractLottieAnimation(bytes, {
			animationId: input.animationId,
			inlineImages: true
		});
		if (animation) {
			if (hasText) applyLottieTextOverrides(animation, input.textOverrides!);
			if (hasColor) applyLottieColorOverrides(animation, input.colorOverrides!);
			data = JSON.stringify(animation);
		}
	}
	return {
		data,
		themeData: input.themeId ? extractLottieThemeData(bytes, input.themeId) : null,
		slots:
			input.slotOverrides && Object.keys(input.slotOverrides).length > 0
				? input.slotOverrides
				: null,
		signature: lottieRenderSignature(input)
	};
}
