import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import {
	collectAdjustmentLayers,
	effectsForItemAtFrame,
	sequenceColorGradeEffectsAtFrame
} from './adjustment-layers';

const tracks: TimelineTrack[] = [
	{
		id: 'grade',
		name: 'Grade',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	},
	{
		id: 'video',
		name: 'Video',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 1
	}
];

function adjustment(sequenceColorGrade: boolean): TimelineItem {
	return {
		id: sequenceColorGrade ? 'sequence-grade' : 'bounded-grade',
		trackId: 'grade',
		from: 0,
		durationInFrames: 1,
		label: 'Grade',
		type: 'adjustment',
		sequenceColorGrade,
		effects: [
			{
				id: 'effect',
				type: 'gpu',
				effectId: 'gpu-brightness',
				enabled: true,
				params: { amount: 0.2 }
			}
		]
	};
}

const clip: TimelineItem = {
	id: 'clip',
	trackId: 'video',
	from: 100,
	durationInFrames: 10,
	label: 'Clip',
	type: 'video',
	effects: []
};

describe('sequence color grade scope', () => {
	it('resolves clip and adjustment keyframes relative to each effect owner', () => {
		const layer = adjustment(false);
		layer.from = 20;
		layer.durationInFrames = 200;
		layer.keyframes = {
			'effect:gpu-brightness:effect:amount': { frames: [0, 100], values: [0.2, 0.8] }
		};
		const animatedClip: TimelineItem = {
			...clip,
			durationInFrames: 100,
			effects: [
				{
					id: 'clip-effect',
					type: 'gpu',
					effectId: 'gpu-brightness',
					enabled: true,
					params: { amount: 0.2 }
				}
			],
			keyframes: {
				'effect:gpu-brightness:clip-effect:amount': { frames: [0, 100], values: [0.2, 0.8] }
			}
		};
		const layers = collectAdjustmentLayers([layer, animatedClip], tracks);
		const effects = effectsForItemAtFrame(animatedClip, 1, layers, 120);
		expect(effects).toHaveLength(2);
		expect(effects[0]).toMatchObject({ id: 'effect', params: { amount: 0.8 } });
		expect(effects[1]).toMatchObject({ id: 'clip-effect', type: 'gpu' });
		if (effects[1]?.type === 'gpu') expect(effects[1].params.amount).toBeCloseTo(0.32);
		expect(layer.effects?.[0]).toMatchObject({ params: { amount: 0.2 } });
		expect(animatedClip.effects?.[0]).toMatchObject({ params: { amount: 0.2 } });
	});
	it('keeps visible adjustment layers when an audio track is soloed', () => {
		const visible = adjustment(false);
		const hidden = { ...adjustment(false), id: 'hidden-grade', trackId: 'hidden' };
		const layers = collectAdjustmentLayers(
			[visible, hidden],
			[
				...tracks,
				{ ...tracks[0]!, id: 'hidden', visible: false, solo: true },
				{ ...tracks[0]!, id: 'audio', kind: 'audio', solo: true }
			]
		);
		expect(layers.map(({ layer }) => layer.id)).toEqual(['bounded-grade']);
	});

	it('bypasses color only for the selected effect owner', () => {
		const bounded = adjustment(false);
		bounded.durationInFrames = 200;
		const gradedClip = {
			...clip,
			effects: [
				{
					id: 'clip-grade',
					type: 'gpu' as const,
					effectId: 'gpu-brightness',
					enabled: true,
					params: { amount: 0.4 }
				}
			]
		};
		const layers = collectAdjustmentLayers([bounded, gradedClip], tracks);

		expect(effectsForItemAtFrame(gradedClip, 1, layers, 100)).toHaveLength(2);
		expect(
			effectsForItemAtFrame(gradedClip, 1, layers, 100, new Set([gradedClip.id])).map(
				(effect) => effect.id
			)
		).toEqual(['effect']);
		expect(
			effectsForItemAtFrame(gradedClip, 1, layers, 100, new Set([bounded.id])).map(
				(effect) => effect.id
			)
		).toEqual(['clip-grade']);
	});

	it('applies once at sequence output while ordinary adjustment layers stay item-scoped', () => {
		const sequenceLayers = collectAdjustmentLayers([adjustment(true), clip], tracks);
		const boundedLayers = collectAdjustmentLayers([adjustment(false), clip], tracks);

		expect(effectsForItemAtFrame(clip, 1, sequenceLayers, 100)).toHaveLength(0);
		expect(sequenceColorGradeEffectsAtFrame(sequenceLayers, 100)).toHaveLength(1);
		expect(effectsForItemAtFrame(clip, 1, boundedLayers, 100)).toHaveLength(0);
		expect(sequenceColorGradeEffectsAtFrame(boundedLayers, 100)).toHaveLength(0);
	});

	it('resolves sequence output effect keyframes at the playhead', () => {
		const grade = adjustment(true);
		grade.durationInFrames = 101;
		grade.keyframes = {
			'effect:gpu-brightness:effect:amount': { frames: [0, 100], values: [0.2, 0.8] }
		};
		const layers = collectAdjustmentLayers([grade, clip], tracks);
		const effect = sequenceColorGradeEffectsAtFrame(layers, 50)[0];

		expect(effect?.type).toBe('gpu');
		if (effect?.type === 'gpu') expect(effect.params.amount).toBeCloseTo(0.5);
	});
});
