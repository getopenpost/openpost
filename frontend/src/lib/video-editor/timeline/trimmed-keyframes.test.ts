import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { cleanupTrimmedKeyframes, countTrimmedKeyframes } from './trimmed-keyframes';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'visual',
		from: 0,
		durationInFrames: 10,
		label: 'Clip',
		type: 'video',
		...overrides
	};
}

const generatedSource = {
	applicationId: 'generated-fade',
	kind: 'built-in-preset' as const,
	presetId: 'fade-in',
	presetName: 'Fade in'
};

describe('trimmed keyframe cleanup', () => {
	it('inserts the evaluated final pose before removing parked scalar keys', () => {
		const clip = item({
			keyframes: {
				opacity: {
					frames: [0, 20],
					values: [0, 1],
					ids: ['start', 'parked'],
					easings: ['linear', 'ease-out'],
					sources: [generatedSource, generatedSource]
				}
			}
		});
		const cleaned = cleanupTrimmedKeyframes(clip, () => 'boundary');
		expect(cleaned.removedCount).toBe(1);
		expect(cleaned.insertedBoundaryCount).toBe(1);
		expect(cleaned.keyframes?.opacity).toMatchObject({
			frames: [0, 9],
			values: [0, 0.45],
			ids: ['start', 'boundary'],
			sources: [generatedSource, generatedSource]
		});
	});

	it('cleans a coupled path without changing its final visible position', () => {
		const clip = item({
			vectorKeyframes: {
				position: [
					{
						id: 'start',
						frame: 0,
						value: { x: 0, y: 10 },
						easing: 'linear',
						source: generatedSource
					},
					{ id: 'parked', frame: 18, value: { x: 180, y: 100 }, easing: 'linear' }
				]
			}
		});
		const cleaned = cleanupTrimmedKeyframes(clip, () => 'boundary');
		expect(cleaned.vectorKeyframes?.position).toMatchObject([
			{ id: 'start', frame: 0, value: { x: 0, y: 10 }, source: generatedSource },
			{ id: 'boundary', frame: 9, value: { x: 90, y: 55 }, source: generatedSource }
		]);
		expect(cleaned.removedCount).toBe(1);
		expect(cleaned.insertedBoundaryCount).toBe(1);
	});

	it('counts keys at and beyond the first trimmed frame', () => {
		const clip = item({
			keyframes: { rotation: { frames: [0, 9, 10, 20], values: [0, 1, 2, 3] } },
			vectorKeyframes: {
				position: [
					{ id: 'visible', frame: 9, value: { x: 0, y: 0 }, easing: 'linear' },
					{ id: 'parked', frame: 10, value: { x: 1, y: 1 }, easing: 'linear' }
				]
			}
		});
		expect(countTrimmedKeyframes(clip)).toBe(3);
	});

	it('returns the original maps when every key is in bounds', () => {
		const clip = item({
			keyframes: { opacity: { frames: [0, 9], values: [0, 1] } }
		});
		const cleaned = cleanupTrimmedKeyframes(clip);
		expect(cleaned.removedCount).toBe(0);
		expect(cleaned.keyframes).toEqual(clip.keyframes);
		expect(cleaned.vectorKeyframes).toBe(clip.vectorKeyframes);
	});
});
