import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	planLinkedMoveGesture,
	planLinkedSlipGesture,
	planRateStretchGesture,
	planRippleTrimGesture,
	planRollingTrimGesture,
	planSlideGesture,
	planSlipGesture,
	planTrimGesture
} from './edit-gesture';
import { variableSpeedDurationInFrames } from './source-time-map';

function mediaItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 100,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('timeline edit gestures', () => {
	it('trims the start while keeping timeline and source windows aligned', () => {
		expect(planTrimGesture(mediaItem(), 'start', 10, [], 30, [], 2)).toEqual({
			patch: { from: 110, durationInFrames: 50, sourceStart: 40 },
			snapTarget: null
		});
	});

	it('trims variable-speed edges at the source frames visible under each handle', () => {
		const ramped = mediaItem({
			from: 100,
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 120,
			speedRamp: [
				{ id: 'normal-in', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
				{ id: 'normal-out', sourceFrame: 90, speed: 1, easing: 'hold' },
				{ id: 'end', sourceFrame: 120, speed: 1, easing: 'linear' }
			]
		});

		expect(planTrimGesture(ramped, 'start', 20, [], 30, [], 2).patch).toEqual({
			from: 120,
			durationInFrames: 70,
			sourceStart: 20
		});
		expect(planTrimGesture(ramped, 'end', -30, [], 30, [], 2).patch).toEqual({
			durationInFrames: 60,
			sourceEnd: 90
		});
	});

	it('extends the start only as far as available source material', () => {
		expect(planTrimGesture(mediaItem(), 'start', -50, [], 30, [], 2).patch).toEqual({
			from: 70,
			durationInFrames: 90,
			sourceStart: 0
		});
	});

	it('clamps end extension to the source and the next clip', () => {
		const next = mediaItem({
			id: 'next',
			from: 175,
			sourceStart: 0,
			sourceEnd: 20
		});
		expect(planTrimGesture(mediaItem(), 'end', 100, [next], 30, [], 2).patch).toEqual({
			durationInFrames: 75,
			sourceEnd: 105
		});
	});

	it('snaps the edited edge before applying source and adjacency clamps', () => {
		const result = planTrimGesture(
			mediaItem(),
			'start',
			-8,
			[],
			30,
			[{ frame: 90, type: 'item-end', itemId: 'left' }],
			4
		);
		expect(result.patch).toEqual({
			from: 90,
			durationInFrames: 70,
			sourceStart: 20
		});
		expect(result.snapTarget).toEqual({
			frame: 90,
			type: 'item-end',
			itemId: 'left'
		});
	});

	it('rolls one cut while preserving both clip windows and the total duration', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			durationInFrames: 50,
			sourceStart: 0,
			sourceEnd: 50,
			sourceDuration: 100
		});
		const right = mediaItem({
			id: 'right',
			from: 50,
			durationInFrames: 50,
			sourceStart: 50,
			sourceEnd: 100,
			sourceDuration: 150
		});
		expect(planRollingTrimGesture(left, right, 10, [], 30, [], 2)).toEqual({
			leftPatch: { durationInFrames: 60, sourceEnd: 60 },
			rightPatch: { from: 60, durationInFrames: 40, sourceStart: 60 },
			snapTarget: null
		});
		expect(planRollingTrimGesture(left, right, -10, [], 30, [], 2)).toEqual({
			leftPatch: { durationInFrames: 40, sourceEnd: 40 },
			rightPatch: { from: 40, durationInFrames: 60, sourceStart: 40 },
			snapTarget: null
		});
	});

	it('refuses a rolling trim when the clips do not share one cut', () => {
		const left = mediaItem({ id: 'left', from: 0, durationInFrames: 40 });
		const right = mediaItem({ id: 'right', from: 50 });
		expect(planRollingTrimGesture(left, right, 5, [], 30, [], 2)).toBeNull();
	});

	it('slips source content in source-native frames without moving the clip', () => {
		const item = mediaItem({ sourceDuration: 240, speed: 2 });
		expect(planSlipGesture(item, -20, 30)).toEqual({
			sourceStart: 70,
			sourceEnd: 130
		});
		expect(planSlipGesture(item, 100, 30)).toEqual({
			sourceStart: 0,
			sourceEnd: 60
		});
	});

	it('slips a variable-speed source window without changing its playback curve', () => {
		const item = mediaItem({
			sourceDuration: 240,
			speedRamp: [
				{ id: 'start', sourceFrame: 30, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 50, speed: 2, easing: 'hold' },
				{ id: 'end', sourceFrame: 90, speed: 1, easing: 'linear' }
			]
		});
		const patch = planSlipGesture(item, -20, 30);
		const slipped = { ...item, ...patch };

		expect(patch).toEqual({
			sourceStart: 50,
			sourceEnd: 110,
			speedRamp: [
				{ id: 'start', sourceFrame: 50, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 70, speed: 2, easing: 'hold' },
				{ id: 'end', sourceFrame: 110, speed: 1, easing: 'linear' }
			]
		});
		expect(variableSpeedDurationInFrames(slipped, 30)).toBeCloseTo(
			variableSpeedDurationInFrames(item, 30),
			6
		);
	});

	it('requires an explicit source end before slipping', () => {
		expect(planSlipGesture(mediaItem({ sourceEnd: undefined }), 10, 30)).toBeNull();
	});

	it('allows forward slip while the source duration is still unknown', () => {
		expect(planSlipGesture(mediaItem({ sourceDuration: undefined }), -10, 30)).toEqual({
			sourceStart: 40,
			sourceEnd: 100
		});
	});

	it('does not offer slip for generated timeline items', () => {
		expect(planSlipGesture({ ...mediaItem(), type: 'text' }, 10, 30)).toBeNull();
	});

	it('slides a clip while trimming both adjacent source windows', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			durationInFrames: 100,
			mediaId: 'media',
			originId: 'origin',
			sourceStart: 0,
			sourceEnd: 100,
			sourceDuration: 400
		});
		const middle = mediaItem({
			id: 'middle',
			from: 100,
			durationInFrames: 100,
			mediaId: 'media',
			originId: 'origin',
			sourceStart: 100,
			sourceEnd: 200,
			sourceDuration: 400
		});
		const right = mediaItem({
			id: 'right',
			from: 200,
			durationInFrames: 100,
			mediaId: 'media',
			originId: 'origin',
			sourceStart: 200,
			sourceEnd: 300,
			sourceDuration: 400
		});
		expect(planSlideGesture(middle, left, right, 20, [], 30, [], 2)).toEqual({
			itemPatch: { from: 120, sourceStart: 120, sourceEnd: 220 },
			leftPatch: { durationInFrames: 120, sourceEnd: 120 },
			rightPatch: { from: 220, durationInFrames: 80, sourceStart: 220 },
			snapTarget: null
		});
	});

	it('uses one constrained delta for every slide participant', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100,
			sourceDuration: 200
		});
		const middle = mediaItem({
			id: 'middle',
			from: 100,
			durationInFrames: 100
		});
		const right = mediaItem({
			id: 'right',
			from: 200,
			durationInFrames: 100,
			sourceStart: 50,
			sourceEnd: 150,
			sourceDuration: 200
		});
		expect(planSlideGesture(middle, left, right, -80, [], 30, [], 2)).toEqual({
			itemPatch: { from: 50 },
			leftPatch: { durationInFrames: 50, sourceEnd: 50 },
			rightPatch: { from: 150, durationInFrames: 150, sourceStart: 0 },
			snapTarget: null
		});
	});

	it('preserves slide source continuity while the source duration is still unknown', () => {
		const shared = {
			trackId: 'video',
			mediaId: 'media',
			originId: 'origin',
			sourceDuration: undefined
		};
		const left = mediaItem({
			...shared,
			id: 'left',
			from: 0,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100
		});
		const middle = mediaItem({
			...shared,
			id: 'middle',
			from: 100,
			durationInFrames: 100,
			sourceStart: 100,
			sourceEnd: 200
		});
		const right = mediaItem({
			...shared,
			id: 'right',
			from: 200,
			durationInFrames: 100,
			sourceStart: 200,
			sourceEnd: 300
		});

		expect(planSlideGesture(middle, left, right, 20, [], 30, [], 2).itemPatch).toEqual({
			from: 120,
			sourceStart: 120,
			sourceEnd: 220
		});
	});

	it('rate stretches the full source window and ripples following clips', () => {
		const item = mediaItem({
			from: 100,
			durationInFrames: 100,
			sourceStart: 50,
			sourceEnd: 150,
			sourceFps: 30,
			speed: 1
		});
		const following = mediaItem({ id: 'following', from: 200 });
		expect(planRateStretchGesture(item, 'end', 100, [following], 30, [], 2)).toEqual({
			patch: { durationInFrames: 200, speed: 0.5 },
			moves: [{ id: 'following', from: 300 }],
			snapTarget: null
		});
	});

	it('snaps a rate-stretched end before resolving speed', () => {
		const item = mediaItem({
			from: 0,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100
		});
		expect(
			planRateStretchGesture(
				item,
				'end',
				48,
				[],
				30,
				[{ frame: 150, type: 'item-start', itemId: 'next' }],
				3
			)
		).toEqual({
			patch: { durationInFrames: 150, speed: 2 / 3 },
			moves: [],
			snapTarget: { frame: 150, type: 'item-start', itemId: 'next' }
		});
	});

	it('trims synchronized linked media with one shared constrained amount', () => {
		const video = mediaItem({ id: 'video', linkedGroupId: 'group' });
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio',
			type: 'audio',
			linkedGroupId: 'group'
		});
		expect(planTrimGesture(video, 'start', 10, [video, audio], 30, [], 2)).toEqual({
			patch: { from: 110, durationInFrames: 50, sourceStart: 40 },
			snapTarget: null,
			linkedPatches: [
				{
					id: 'audio',
					patch: { from: 110, durationInFrames: 50, sourceStart: 40 }
				}
			]
		});
	});

	it('moves synchronized linked media by one snapped timeline delta', () => {
		const video = mediaItem({ id: 'video', linkedGroupId: 'group' });
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio',
			type: 'audio',
			linkedGroupId: 'group'
		});
		expect(planLinkedMoveGesture(video, 125, [video, audio])).toEqual([
			{ id: 'video', from: 125 },
			{ id: 'audio', from: 125 }
		]);
	});

	it('moves every explicitly selected linked group by one shared delta', () => {
		const firstVideo = mediaItem({
			id: 'first-video',
			from: 10,
			linkedGroupId: 'first'
		});
		const firstAudio = mediaItem({
			...firstVideo,
			id: 'first-audio',
			trackId: 'audio',
			type: 'audio'
		});
		const second = mediaItem({ id: 'second', from: 100 });

		expect(
			planLinkedMoveGesture(
				firstVideo,
				30,
				[firstVideo, firstAudio, second],
				['first-video', 'second']
			)
		).toEqual([
			{ id: 'first-video', from: 30 },
			{ id: 'first-audio', from: 30 },
			{ id: 'second', from: 120 }
		]);
	});

	it('stops every selected and linked item at the tightest visual same-track gap', () => {
		const firstVideo = mediaItem({
			id: 'first-video',
			from: 10,
			durationInFrames: 30,
			linkedGroupId: 'first'
		});
		const firstAudio = mediaItem({
			...firstVideo,
			id: 'first-audio',
			trackId: 'audio',
			type: 'audio'
		});
		const secondVideo = mediaItem({
			id: 'second-video',
			from: 100,
			durationInFrames: 20
		});
		const videoBlocker = mediaItem({
			id: 'video-blocker',
			from: 145,
			durationInFrames: 30
		});
		const audioBlocker = mediaItem({
			id: 'audio-blocker',
			trackId: 'audio',
			type: 'audio',
			from: 55,
			durationInFrames: 30
		});

		expect(
			planLinkedMoveGesture(
				firstVideo,
				50,
				[firstVideo, firstAudio, secondVideo, videoBlocker, audioBlocker],
				['first-video', 'second-video']
			)
		).toEqual([
			{ id: 'first-video', from: 35 },
			{ id: 'first-audio', from: 35 },
			{ id: 'second-video', from: 125 }
		]);
	});

	it('keeps audio-only items free to overlap for mixing', () => {
		const moving = mediaItem({
			id: 'moving-audio',
			trackId: 'audio',
			type: 'audio',
			from: 10,
			durationInFrames: 30
		});
		const mix = mediaItem({
			id: 'mix-audio',
			trackId: 'audio',
			type: 'audio',
			from: 55,
			durationInFrames: 30
		});

		expect(planLinkedMoveGesture(moving, 50, [moving, mix])).toEqual([
			{ id: 'moving-audio', from: 50 }
		]);
	});

	it('can leave a legacy overlap and ignores simultaneous items on another track', () => {
		const moving = mediaItem({ id: 'moving', from: 50, durationInFrames: 30 });
		const legacyOverlap = mediaItem({ id: 'legacy', from: 40, durationInFrames: 30 });
		const otherTrack = mediaItem({
			id: 'overlay',
			trackId: 'overlay',
			from: 80,
			durationInFrames: 100
		});
		const newBlocker = mediaItem({ id: 'new-blocker', from: 130, durationInFrames: 30 });

		expect(
			planLinkedMoveGesture(moving, 120, [moving, legacyOverlap, otherTrack, newBlocker])
		).toEqual([{ id: 'moving', from: 100 }]);
	});

	it('slips synchronized linked media in one source-space edit', () => {
		const video = mediaItem({
			id: 'video',
			linkedGroupId: 'group',
			sourceDuration: 240
		});
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio',
			type: 'audio',
			linkedGroupId: 'group',
			sourceDuration: 100
		});
		expect(planLinkedSlipGesture(video, -30, [video, audio], 30)).toEqual([
			{ id: 'video', patch: { sourceStart: 40, sourceEnd: 100 } },
			{ id: 'audio', patch: { sourceStart: 40, sourceEnd: 100 } }
		]);
	});

	it('slips synchronized linked speed curves by the same clamped source delta', () => {
		const speedRamp = [
			{ id: 'start', sourceFrame: 30, speed: 1, easing: 'hold' as const },
			{ id: 'fast', sourceFrame: 60, speed: 2, easing: 'linear' as const },
			{ id: 'end', sourceFrame: 90, speed: 1, easing: 'linear' as const }
		];
		const video = mediaItem({
			id: 'video',
			linkedGroupId: 'group',
			sourceDuration: 240,
			speedRamp
		});
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio',
			type: 'audio',
			linkedGroupId: 'group',
			sourceDuration: 100,
			speedRamp: speedRamp.map((point) => ({ ...point, id: `audio-${point.id}` }))
		});

		expect(planLinkedSlipGesture(video, -30, [video, audio], 30)).toEqual([
			{
				id: 'video',
				patch: {
					sourceStart: 40,
					sourceEnd: 100,
					speedRamp: speedRamp.map((point) => ({ ...point, sourceFrame: point.sourceFrame + 10 }))
				}
			},
			{
				id: 'audio',
				patch: {
					sourceStart: 40,
					sourceEnd: 100,
					speedRamp: speedRamp.map((point) => ({
						...point,
						id: `audio-${point.id}`,
						sourceFrame: point.sourceFrame + 10
					}))
				}
			}
		]);
	});

	it('clamps a slip before it consumes a transition source handle', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			sourceStart: 0,
			sourceEnd: 60,
			sourceDuration: 120
		});
		const right = mediaItem({
			id: 'right',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			sourceDuration: 180
		});
		const transition = {
			id: 'transition',
			type: 'crossfade' as const,
			durationInFrames: 20,
			fromItemId: left.id,
			toItemId: right.id
		};
		expect(planLinkedSlipGesture(right, 100, [left, right], 30, [transition])).toEqual([
			{ id: 'right', patch: { sourceStart: 10, sourceEnd: 70 } }
		]);
	});

	it('rolls synchronized companion cuts together', () => {
		const leftVideo = mediaItem({
			id: 'left-video',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			linkedGroupId: 'left'
		});
		const leftAudio = mediaItem({
			...leftVideo,
			id: 'left-audio',
			trackId: 'audio',
			type: 'audio'
		});
		const rightVideo = mediaItem({
			id: 'right-video',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			linkedGroupId: 'right'
		});
		const rightAudio = mediaItem({
			...rightVideo,
			id: 'right-audio',
			trackId: 'audio',
			type: 'audio'
		});
		const result = planRollingTrimGesture(
			leftVideo,
			rightVideo,
			5,
			[leftVideo, leftAudio, rightVideo, rightAudio],
			30,
			[],
			2
		);
		expect(result?.linkedPatches).toEqual([
			{
				id: 'left-audio',
				patch: { durationInFrames: 65, sourceEnd: 65 }
			},
			{
				id: 'right-audio',
				patch: { from: 65, durationInFrames: 55, sourceStart: 65 }
			}
		]);
	});

	it('keeps a transition attached and its keyframes outside the blend region', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			keyframes: { opacity: { frames: [40], values: [1] } }
		});
		const right = mediaItem({
			id: 'right',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120
		});
		const transition = {
			id: 'transition',
			type: 'crossfade' as const,
			durationInFrames: 12,
			fromItemId: left.id,
			toItemId: right.id
		};

		expect(planTrimGesture(left, 'end', -10, [left, right], 30, [], 2, [transition]).patch).toEqual(
			{ durationInFrames: 60, sourceEnd: 60 }
		);
		expect(
			planRollingTrimGesture(left, right, -20, [left, right], 30, [], 2, [transition])?.leftPatch
		).toEqual({ durationInFrames: 47, sourceEnd: 47 });
	});

	it('rate stretches linked media, scales keys, and ripples both linked tracks', () => {
		const video = mediaItem({
			id: 'video',
			from: 0,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100,
			sourceDuration: 200,
			linkedGroupId: 'current',
			keyframes: { opacity: { frames: [0, 50, 99], values: [0, 0.5, 1] } },
			vectorKeyframes: {
				position: [
					{ id: 'start', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
					{ id: 'end', frame: 99, value: { x: 100, y: 50 }, easing: 'linear' }
				]
			}
		});
		const audio = mediaItem({
			...video,
			id: 'audio',
			trackId: 'audio',
			type: 'audio',
			vectorKeyframes: undefined,
			keyframes: { volume: { frames: [25], values: [0.5] } }
		});
		const nextVideo = mediaItem({
			id: 'next-video',
			from: 100,
			linkedGroupId: 'next'
		});
		const nextAudio = mediaItem({
			...nextVideo,
			id: 'next-audio',
			trackId: 'audio',
			type: 'audio'
		});
		const plan = planRateStretchGesture(
			video,
			'end',
			100,
			[video, audio, nextVideo, nextAudio],
			30,
			[],
			2
		);

		expect(plan?.patch).toMatchObject({
			durationInFrames: 200,
			speed: 0.5,
			keyframes: { opacity: { frames: [0, 100, 198], values: [0, 0.5, 1] } },
			vectorKeyframes: {
				position: [
					{ id: 'start', frame: 0, value: { x: 0, y: 0 } },
					{ id: 'end', frame: 198, value: { x: 100, y: 50 } }
				]
			}
		});
		expect(plan?.linkedPatches).toEqual([
			{
				id: 'audio',
				patch: {
					durationInFrames: 200,
					speed: 0.5,
					keyframes: { volume: { frames: [50], values: [0.5] } }
				}
			}
		]);
		expect(plan?.moves).toEqual([
			{ id: 'next-video', from: 200 },
			{ id: 'next-audio', from: 200 }
		]);
	});

	it('rate stretches from the start without moving upstream clips before frame zero', () => {
		const item = mediaItem({
			from: 100,
			durationInFrames: 100,
			sourceStart: 50,
			sourceEnd: 150,
			sourceFps: 30,
			keyframes: { opacity: { frames: [0, 50, 99], values: [0, 0.5, 1] } }
		});
		const preceding = mediaItem({
			id: 'preceding',
			from: 40,
			durationInFrames: 60
		});
		expect(planRateStretchGesture(item, 'start', -100, [preceding], 30, [], 2)).toEqual({
			patch: {
				from: 60,
				durationInFrames: 140,
				speed: 100 / 140,
				keyframes: { opacity: { frames: [0, 70, 139], values: [0, 0.5, 1] } }
			},
			moves: [{ id: 'preceding', from: 0 }],
			snapTarget: null
		});
	});

	it('uses the tightest upstream track limit for a linked start-edge stretch', () => {
		const item = mediaItem({
			from: 100,
			durationInFrames: 100,
			sourceStart: 50,
			sourceEnd: 150,
			sourceFps: 30,
			linkedGroupId: 'current'
		});
		const linkedAudio = mediaItem({
			...item,
			id: 'audio',
			trackId: 'audio',
			type: 'audio'
		});
		const precedingVideo = mediaItem({
			id: 'preceding-video',
			from: 40,
			durationInFrames: 60
		});
		const precedingAudio = mediaItem({
			id: 'preceding-audio',
			trackId: 'audio',
			type: 'audio',
			from: 5,
			durationInFrames: 95
		});

		const plan = planRateStretchGesture(
			item,
			'start',
			-100,
			[precedingVideo, precedingAudio, linkedAudio],
			30,
			[],
			2
		);

		expect(plan?.patch.from).toBe(95);
		expect(plan?.patch.durationInFrames).toBe(105);
		expect(plan?.linkedPatches?.[0]?.patch.from).toBe(95);
		expect(plan?.moves).toEqual([
			{ id: 'preceding-video', from: 35 },
			{ id: 'preceding-audio', from: 0 }
		]);
	});

	it('snaps a start-handle rate stretch and keeps its original end fixed', () => {
		const item = mediaItem({
			from: 100,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100
		});
		expect(
			planRateStretchGesture(
				item,
				'start',
				48,
				[],
				30,
				[{ frame: 150, type: 'item-end', itemId: 'previous' }],
				3
			)
		).toEqual({
			patch: { from: 150, durationInFrames: 50, speed: 2 },
			moves: [],
			snapTarget: { frame: 150, type: 'item-end', itemId: 'previous' }
		});
	});

	it('ripple trims an end and moves all later linked groups on touched tracks', () => {
		const video = mediaItem({
			id: 'video',
			from: 0,
			durationInFrames: 100,
			sourceStart: 0,
			sourceEnd: 100,
			linkedGroupId: 'current'
		});
		const audio = mediaItem({
			...video,
			id: 'audio',
			trackId: 'audio',
			type: 'audio'
		});
		const nextVideo = mediaItem({
			id: 'next-video',
			from: 100,
			linkedGroupId: 'next'
		});
		const nextAudio = mediaItem({
			...nextVideo,
			id: 'next-audio',
			trackId: 'audio',
			type: 'audio'
		});

		expect(
			planRippleTrimGesture(video, 'end', -20, [video, audio, nextVideo, nextAudio], 30, [], 2)
		).toEqual({
			patch: { durationInFrames: 80, sourceEnd: 80 },
			linkedPatches: [{ id: 'audio', patch: { durationInFrames: 80, sourceEnd: 80 } }],
			moves: [
				{ id: 'next-video', from: 80 },
				{ id: 'next-audio', from: 80 }
			],
			snapTarget: null
		});
	});

	it('ripple trims a start in place and shifts later clips by the duration change', () => {
		const item = mediaItem({
			from: 100,
			durationInFrames: 60,
			sourceStart: 30,
			sourceEnd: 90
		});
		const following = mediaItem({ id: 'following', from: 160 });

		expect(planRippleTrimGesture(item, 'start', 10, [following], 30, [], 2)).toEqual({
			patch: { from: 100, durationInFrames: 50, sourceStart: 40 },
			moves: [{ id: 'following', from: 150 }],
			snapTarget: null
		});
	});

	it('leaves other tracks to sync-lock propagation when a downstream clip is linked', () => {
		const item = mediaItem({ from: 0, durationInFrames: 100, sourceStart: 0, sourceEnd: 100 });
		const nextVideo = mediaItem({
			id: 'next-video',
			from: 100,
			linkedGroupId: 'next'
		});
		const nextAudio = mediaItem({
			...nextVideo,
			id: 'next-audio',
			trackId: 'audio',
			type: 'audio'
		});

		expect(
			planRippleTrimGesture(item, 'end', -20, [nextVideo, nextAudio], 30, [], 2).moves
		).toEqual([{ id: 'next-video', from: 80 }]);
	});

	it('slides the synchronized companion and both cuts on its track', () => {
		const chainItem = (
			id: string,
			trackId: string,
			type: TimelineItem['type'],
			from: number,
			linkedGroupId: string
		) =>
			mediaItem({
				id,
				trackId,
				type,
				from,
				durationInFrames: 100,
				mediaId: 'media',
				originId: 'origin',
				linkedGroupId,
				sourceStart: from,
				sourceEnd: from + 100,
				sourceDuration: 400
			});
		const leftVideo = chainItem('left-video', 'video', 'video', 0, 'left');
		const middleVideo = chainItem('middle-video', 'video', 'video', 100, 'middle');
		const rightVideo = chainItem('right-video', 'video', 'video', 200, 'right');
		const leftAudio = chainItem('left-audio', 'audio', 'audio', 0, 'left');
		const middleAudio = chainItem('middle-audio', 'audio', 'audio', 100, 'middle');
		const rightAudio = chainItem('right-audio', 'audio', 'audio', 200, 'right');

		const plan = planSlideGesture(
			middleVideo,
			leftVideo,
			rightVideo,
			20,
			[leftVideo, middleVideo, rightVideo, leftAudio, middleAudio, rightAudio],
			30,
			[],
			2
		);

		expect(plan.linkedPatches).toEqual([
			{
				id: 'middle-audio',
				patch: { from: 120, sourceStart: 120, sourceEnd: 220 }
			},
			{
				id: 'left-audio',
				patch: { durationInFrames: 120, sourceEnd: 120 }
			},
			{
				id: 'right-audio',
				patch: { from: 220, durationInFrames: 80, sourceStart: 220 }
			}
		]);
	});
});
