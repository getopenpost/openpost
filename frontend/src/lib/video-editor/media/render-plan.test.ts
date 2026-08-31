import { describe, expect, it } from 'vitest';
import type {
	SubComposition,
	SubtitleCue,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import {
	applyMixEntryGain,
	frameToSourceSeconds,
	isVisibleAtFrame,
	outputDurationFrames,
	paintOrder,
	planMixdown,
	planNestedMixdown,
	selectCuesAtFrame,
	sliceMixEntries,
	transitionBlendAtFrame
} from './render-plan';

function track(
	id: string,
	kind: 'video' | 'audio',
	order: number,
	extra: Partial<TimelineTrack> = {}
): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...extra
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'video',
		...extra
	};
}

describe('outputDurationFrames', () => {
	it('returns the max item end frame', () => {
		expect(
			outputDurationFrames([
				item({ from: 10, durationInFrames: 40 }),
				item({ durationInFrames: 200 })
			])
		).toBe(200);
	});

	it('returns zero for an empty timeline', () => {
		expect(outputDurationFrames([])).toBe(0);
	});
});

describe('isVisibleAtFrame', () => {
	it('includes the start frame and excludes the end frame', () => {
		const clip = item({ from: 30, durationInFrames: 20 });
		expect(isVisibleAtFrame(clip, 29)).toBe(false);
		expect(isVisibleAtFrame(clip, 30)).toBe(true);
		expect(isVisibleAtFrame(clip, 49)).toBe(true);
		expect(isVisibleAtFrame(clip, 50)).toBe(false);
	});
});

describe('frameToSourceSeconds', () => {
	it('maps timeline frames to source time at matching fps', () => {
		const clip = item({ sourceStart: 30, sourceFps: 30 });
		expect(frameToSourceSeconds(clip, 0, 30)).toBeCloseTo(1);
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(2);
	});

	it('scales by speed and respects a different source fps', () => {
		const clip = item({ sourceStart: 0, sourceFps: 60, speed: 2 });
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(2);
		expect(frameToSourceSeconds(clip, 15, 30)).toBeCloseTo(1);
	});

	it('maps reversed clips from the exclusive source end toward the source start', () => {
		const clip = item({
			from: 10,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 180,
			sourceFps: 60,
			speed: 2,
			isReversed: true
		});
		expect(frameToSourceSeconds(clip, 10, 30)).toBeCloseTo(179 / 60);
		expect(frameToSourceSeconds(clip, 25, 30)).toBeCloseTo(119 / 60);
		expect(frameToSourceSeconds(clip, 40, 30)).toBeCloseTo(59 / 60);
	});

	it('uses available source handles outside the reversed clip window', () => {
		const clip = item({
			from: 30,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 90,
			sourceDuration: 120,
			sourceFps: 30,
			isReversed: true
		});
		expect(frameToSourceSeconds(clip, 15, 30)).toBeCloseTo(104 / 30);
		expect(frameToSourceSeconds(clip, 75, 30)).toBeCloseTo(44 / 30);
	});

	it('maps a persisted variable-speed curve to the same source frames used by export', () => {
		const clip = item({
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 120,
			sourceFps: 30,
			speed: 1,
			speedRamp: [
				{ id: 'normal-in', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
				{ id: 'normal-out', sourceFrame: 90, speed: 1, easing: 'hold' },
				{ id: 'end', sourceFrame: 120, speed: 1, easing: 'linear' }
			]
		});

		expect(frameToSourceSeconds(clip, 0, 30)).toBeCloseTo(0);
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(1);
		expect(frameToSourceSeconds(clip, 60, 30)).toBeCloseTo(3);
		expect(frameToSourceSeconds(clip, 90, 30)).toBeCloseTo(4);
	});
});

describe('planMixdown', () => {
	it('applies parent group mute without changing the child track state', () => {
		const group = track('dialogue-group', 'audio', 0, {
			kind: undefined,
			isGroup: true,
			muted: true
		});
		const child = track('dialogue', 'audio', 1, { parentTrackId: group.id });
		const entries = planMixdown(
			[item({ trackId: child.id, type: 'audio', mediaId: 'voice' })],
			[group, child],
			30
		);
		expect(entries).toEqual([]);
		expect(child.muted).toBe(false);
	});

	it('schedules clips at their timeline offsets with volume gain', () => {
		const entries = planMixdown(
			[
				item({
					id: 'a',
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'media-a',
					from: 60,
					durationInFrames: 90,
					sourceStart: 45,
					sourceFps: 30,
					volume: 0.5
				})
			],
			[track('track-audio', 'audio', 2, { volume: 0.8 })],
			30
		);
		expect(entries.length).toBe(1);
		const entry = entries[0]!;
		expect(entry.mediaId).toBe('media-a');
		expect(entry.whenSeconds).toBe(2);
		expect(entry.sourceOffsetSeconds).toBe(1.5);
		expect(entry.playbackRate).toBe(1);
		expect(entry.durationSeconds).toBe(3);
		expect(entry.gainPoints[0]?.value).toBeCloseTo(0.4);
		expect(entry.previewGainPoints[0]?.value).toBeCloseTo(0.5);
		expect(entry.mixerTrackGain).toBeCloseTo(0.8);
		const mastered = applyMixEntryGain(entries, 0.5)[0]!;
		expect(mastered.gainPoints[0]?.value).toBeCloseTo(0.2);
		expect(mastered.previewGainPoints[0]?.value).toBeCloseTo(0.25);
	});

	it('drops muted tracks and items without media', () => {
		const entries = planMixdown(
			[
				item({ mediaId: 'muted-clip' }),
				item({ id: 'no-media', type: 'audio' }),
				item({ id: 'subtitle-only', type: 'subtitle', mediaId: 'captions' })
			],
			[track('track-video-main', 'video', 1, { muted: true })],
			30
		);
		expect(entries).toEqual([]);
	});

	it('drops audio from hidden video tracks', () => {
		const entries = planMixdown(
			[item({ mediaId: 'hidden-video-audio' })],
			[track('track-video-main', 'video', 1, { visible: false })],
			30
		);
		expect(entries).toEqual([]);
	});

	it('mutes non-soloed tracks when any track is soloed', () => {
		const tracks = [
			track('track-video-main', 'video', 1),
			track('track-audio', 'audio', 2, { solo: true })
		];
		const entries = planMixdown(
			[
				item({ mediaId: 'main-audio' }),
				item({ id: 'soloed', trackId: 'track-audio', mediaId: 'solo-audio' })
			],
			tracks,
			30
		);
		expect(entries.map((entry) => entry.mediaId)).toEqual(['solo-audio']);
	});

	it('applies speed as playback rate and shrinks real duration', () => {
		const entries = planMixdown(
			[item({ mediaId: 'fast', speed: 2, durationInFrames: 60 })],
			[track('track-video-main', 'video', 1)],
			30
		);
		expect(entries[0]?.playbackRate).toBe(2);
		expect(entries[0]?.durationSeconds).toBeCloseTo(2);
	});

	it('plans the exact source window and tempo curve for variable-speed audio export', () => {
		const [entry] = planMixdown(
			[
				item({
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'voice',
					durationInFrames: 90,
					sourceStart: 0,
					sourceEnd: 120,
					sourceFps: 30,
					speedRamp: [
						{ id: 'normal-in', sourceFrame: 0, speed: 1, easing: 'hold' },
						{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
						{ id: 'normal-out', sourceFrame: 90, speed: 1, easing: 'hold' },
						{ id: 'end', sourceFrame: 120, speed: 1, easing: 'linear' }
					]
				})
			],
			[track('track-audio', 'audio', 0)],
			30
		);

		expect(entry?.sourceWindowStartSeconds).toBeCloseTo(0);
		expect(entry?.sourceWindowEndSeconds).toBeCloseTo(4);
		expect(entry?.durationSeconds).toBeCloseTo(3);
		expect(entry?.playbackRateCurve?.find((point) => point.atSeconds === 1)?.rate).toBe(2);
		expect(entry?.playbackRateCurve?.find((point) => point.atSeconds === 2)?.rate).toBe(1);

		const sliced = sliceMixEntries([entry!], 1, 2)[0]!;
		expect(sliced.sourceOffsetSeconds).toBeCloseTo(1, 5);
		expect(sliced.sourceWindowStartSeconds).toBeCloseTo(1, 5);
		expect(sliced.sourceWindowEndSeconds).toBeCloseTo(3, 5);
		expect(sliced.playbackRate).toBe(2);
		expect(sliced.durationSeconds).toBe(1);
	});

	it('plans independent pitch and the clip EQ without changing gain or tempo', () => {
		const [entry] = planMixdown(
			[
				item({
					mediaId: 'dialogue',
					speed: 1.5,
					volume: 0.5,
					audioPitchSemitones: 3,
					audioPitchCents: 25,
					audioEqEnabled: true,
					audioEqHighMidGainDb: 4
				})
			],
			[track('track-video-main', 'video', 1)],
			30
		);
		expect(entry?.playbackRate).toBe(1.5);
		expect(entry?.pitchShiftSemitones).toBe(3.25);
		expect(entry?.gainPoints[0]?.value).toBe(0.5);
		expect(entry?.audioEqStages).toHaveLength(1);
		expect(entry?.audioEqStages[0]?.highMidGainDb).toBe(4);
	});

	it('schedules and range-slices reversed audio from the exclusive source end', () => {
		const entries = planMixdown(
			[
				item({
					mediaId: 'reverse',
					sourceStart: 30,
					sourceEnd: 150,
					sourceFps: 30,
					durationInFrames: 60,
					speed: 2,
					isReversed: true
				})
			],
			[track('track-video-main', 'video', 1)],
			30
		);
		expect(entries[0]).toMatchObject({
			sourceOffsetSeconds: 5,
			playbackRate: 2,
			reversed: true
		});
		const sliced = sliceMixEntries(entries, 1, 2)[0]!;
		expect(sliced.sourceOffsetSeconds).toBe(3);
		expect(sliced.durationSeconds).toBe(1);
	});

	it('emits keyframed volume automation points in mix time', () => {
		const entries = planMixdown(
			[
				item({
					id: 'fade',
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'faded',
					from: 30,
					durationInFrames: 60,
					keyframes: { volume: { frames: [0, 60], values: [0, 1] } }
				})
			],
			[track('track-audio', 'audio', 2)],
			30
		);
		const points = entries[0]?.gainPoints ?? [];
		expect(points.length).toBeGreaterThanOrEqual(2);
		expect(points[0]).toMatchObject({ whenSeconds: 1, value: 0 });
		expect(points[points.length - 1]).toMatchObject({
			whenSeconds: 3,
			value: 1
		});
	});

	it('composes clip fades with volume automation for rendered audio', () => {
		const entries = planMixdown(
			[
				item({
					id: 'clip-fade',
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'voice',
					from: 30,
					durationInFrames: 60,
					volume: 0.5,
					audioFadeIn: 1,
					audioFadeOut: 1
				})
			],
			[track('track-audio', 'audio', 2, { volume: 0.8 })],
			30
		);
		const points = entries[0]?.gainPoints ?? [];
		expect(points.find((point) => point.whenSeconds === 1)?.value).toBe(0);
		expect(points.find((point) => point.whenSeconds === 2)?.value).toBeCloseTo(0.4);
		expect(points.find((point) => point.whenSeconds === 3)?.value).toBe(0);
	});
});

describe('planNestedMixdown', () => {
	it('maps leaf audio through a trimmed and retimed sequence wrapper', () => {
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [
				item({
					id: 'leaf',
					type: 'audio',
					trackId: 'nested-audio',
					mediaId: 'voice',
					from: 30,
					durationInFrames: 120,
					sourceStart: 60,
					sourceFps: 60,
					volume: 0.5
				})
			],
			tracks: [track('nested-audio', 'audio', 0, { volume: 0.5 })],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 150
		};
		const wrapper = item({
			id: 'wrapper',
			type: 'audio',
			trackId: 'root-audio',
			mediaId: undefined,
			compositionId: 'nested',
			from: 60,
			durationInFrames: 45,
			sourceStart: 45,
			sourceEnd: 135,
			sourceFps: 30,
			speed: 2,
			volume: 0.5
		});

		const entries = planNestedMixdown(
			[wrapper],
			[track('root-audio', 'audio', 0, { volume: 0.5 })],
			30,
			[],
			[nested]
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			itemId: 'wrapper/leaf',
			mediaId: 'voice',
			whenSeconds: 2,
			sourceOffsetSeconds: 1.5,
			playbackRate: 2,
			durationSeconds: 1.5
		});
		expect(entries[0]?.gainPoints[0]?.value).toBeCloseTo(0.0625);
	});

	it('does not double schedule a linked visual and audio wrapper pair', () => {
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [
				item({
					id: 'leaf',
					type: 'audio',
					trackId: 'nested-audio',
					mediaId: 'voice',
					durationInFrames: 30
				})
			],
			tracks: [track('nested-audio', 'audio', 0)],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrappers = [
			item({
				id: 'visual-wrapper',
				type: 'composition',
				compositionId: 'nested',
				linkedGroupId: 'pair',
				mediaId: undefined,
				durationInFrames: 30
			}),
			item({
				id: 'audio-wrapper',
				type: 'audio',
				trackId: 'root-audio',
				compositionId: 'nested',
				linkedGroupId: 'pair',
				mediaId: undefined,
				durationInFrames: 30
			})
		];
		const entries = planNestedMixdown(
			wrappers,
			[track('track-video-main', 'video', 0), track('root-audio', 'audio', 1)],
			30,
			[],
			[nested]
		);
		expect(entries.map((entry) => entry.itemId)).toEqual(['audio-wrapper/leaf']);
	});

	it('stops recursive cycles while still scheduling reachable leaves once', () => {
		const cycle: SubComposition = {
			id: 'cycle',
			name: 'Cycle',
			items: [
				item({
					id: 'leaf',
					type: 'audio',
					trackId: 'cycle-audio',
					mediaId: 'voice',
					durationInFrames: 30
				}),
				item({
					id: 'self',
					type: 'audio',
					trackId: 'cycle-audio',
					mediaId: undefined,
					compositionId: 'cycle',
					durationInFrames: 30
				})
			],
			tracks: [track('cycle-audio', 'audio', 0)],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const entries = planNestedMixdown(
			[
				item({
					id: 'root-wrapper',
					type: 'audio',
					trackId: 'root-audio',
					mediaId: undefined,
					compositionId: 'cycle',
					durationInFrames: 30
				})
			],
			[track('root-audio', 'audio', 0)],
			30,
			[],
			[cycle]
		);
		expect(entries.map((entry) => entry.mediaId)).toEqual(['voice']);
	});
});

describe('transitionBlendAtFrame', () => {
	const clips = new Map([
		['left', item({ id: 'left', from: 0, durationInFrames: 100 })],
		['right', item({ id: 'right', from: 100, durationInFrames: 100 })]
	]);
	const transitions: TimelineTransition[] = [
		{
			id: 't',
			type: 'crossfade',
			durationInFrames: 20,
			fromItemId: 'left',
			toItemId: 'right'
		}
	];

	it('returns null outside the transition window', () => {
		expect(transitionBlendAtFrame(transitions, clips, 89)).toBeNull();
		expect(transitionBlendAtFrame(transitions, clips, 110)).toBeNull();
	});

	it('reports progress across the window', () => {
		expect(transitionBlendAtFrame(transitions, clips, 90)).toMatchObject({
			outgoingId: 'left',
			incomingId: 'right',
			progress: 0
		});
		expect(transitionBlendAtFrame(transitions, clips, 100)).toMatchObject({
			progress: 10 / 19
		});
		expect(transitionBlendAtFrame(transitions, clips, 109)).toMatchObject({
			progress: 1
		});
	});

	it('ignores transitions whose items are gone', () => {
		const orphaned: TimelineTransition[] = [{ ...transitions[0]!, toItemId: 'missing' }];
		expect(transitionBlendAtFrame(orphaned, clips, 100)).toBeNull();
	});
});

describe('paintOrder', () => {
	it('paints higher-order tracks first so overlays end up on top', () => {
		const tracks = [track('overlay', 'video', 0), track('main', 'video', 1)];
		const ordered = paintOrder(
			[item({ id: 'base', trackId: 'main' }), item({ id: 'top', trackId: 'overlay' })],
			tracks
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['base', 'top']);
	});

	it('omits items on hidden tracks from the visual plan', () => {
		const tracks = [track('shown', 'video', 0), track('hidden', 'video', 1, { visible: false })];
		const ordered = paintOrder(
			[
				item({ id: 'shown-item', trackId: 'shown' }),
				item({ id: 'hidden-item', trackId: 'hidden' })
			],
			tracks
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['shown-item']);
	});

	it('renders only solo tracks when any track is soloed', () => {
		const ordered = paintOrder(
			[item({ id: 'normal-item', trackId: 'normal' }), item({ id: 'solo-item', trackId: 'solo' })],
			[track('normal', 'video', 0), track('solo', 'video', 1, { solo: true })]
		);

		expect(ordered.map((entry) => entry.id)).toEqual(['solo-item']);
	});
});

describe('selectCuesAtFrame', () => {
	const cues: SubtitleCue[] = [
		{ id: 'a', startFrame: 0, endFrame: 30, text: 'Hello' },
		{ id: 'b', startFrame: 30, endFrame: 60, text: 'World' }
	];

	it('selects only the active cue', () => {
		expect(selectCuesAtFrame(cues, 10).map((cue) => cue.id)).toEqual(['a']);
		expect(selectCuesAtFrame(cues, 30).map((cue) => cue.id)).toEqual(['b']);
	});

	it('returns nothing between cues or past the end', () => {
		expect(selectCuesAtFrame(cues, -1)).toEqual([]);
		expect(selectCuesAtFrame(cues, 60)).toEqual([]);
	});
});
