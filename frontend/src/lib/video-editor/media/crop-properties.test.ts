import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	cropPropertyValuePixels,
	cropSourceDimensions,
	cropWithPropertyPixels
} from './crop-properties';

function item(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		sourceWidth: 1280,
		sourceHeight: 720,
		...patch
	};
}

describe('crop property pixel boundary', () => {
	it('round-trips edge and signed softness values against source dimensions', () => {
		const dimensions = cropSourceDimensions(item());
		const crop = cropWithPropertyPixels(undefined, 'cropLeft', 320, dimensions);
		const softened = cropWithPropertyPixels(crop, 'cropSoftness', -180, dimensions);

		expect(softened.left).toBe(0.25);
		expect(softened.softness).toBe(-0.25);
		expect(cropPropertyValuePixels(softened, 'cropLeft', dimensions)).toBe(320);
		expect(cropPropertyValuePixels(softened, 'cropSoftness', dimensions)).toBe(-180);
	});

	it('keeps opposite crop edges below the visible-source limit', () => {
		const dimensions = cropSourceDimensions(item());
		const crop = cropWithPropertyPixels(
			{ top: 0, right: 0.75, bottom: 0, left: 0 },
			'cropLeft',
			640,
			dimensions
		);

		expect(crop.left + crop.right).toBeCloseTo(0.999, 6);
	});

	it('uses composition dimensions before transform or project fallbacks', () => {
		expect(
			cropSourceDimensions(
				item({
					type: 'composition',
					sourceWidth: undefined,
					sourceHeight: undefined,
					compositionWidth: 1080,
					compositionHeight: 1920,
					transform: { width: 540, height: 960 }
				})
			)
		).toEqual({ width: 1080, height: 1920 });
	});
});
