import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { planMixdown, sliceMixEntries } from '../media/render-plan';
import {
	audioCrossfadeGainAtFrame,
	buildTransitionGainCurve,
	equalPowerGain,
	isAudioTransitionParticipantAtFrame,
	transitionGainSpansForItem,
	type TransitionGainSpan
} from './transition-crossfade';

const FPS = 30;

function track(id: string, kind: 'video' | 'audio' = 'video', volume = 1): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: kind === 'video' ? 0 : 1,
		volume
	};
}

function clip(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 60,
		label: '',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 90,
		sourceFps: FPS,
		...extra
	};
}

function transition(
	fromItemId: string,
	toItemId: string,
	durationInFrames = 20,
	extra: Partial<TimelineTransition> = {}
): TimelineTransition {
	return {
		id: `transition-${fromItemId}-${toItemId}`,
		type: 'crossfade',
		durationInFrames,
		fromItemId,
		toItemId,
		...extra
	};
}

function cutPair(durationInFrames = 20) {
	const left = clip({ id: 'left' });
	const right = clip({
		id: 'right',
		from: 60,
		mediaId: 'media-2',
		sourceStart: 10,
		sourceEnd: 70
	});
	return {
		left,
		right,
		transition: transition('left', 'right', durationInFrames),
		itemsById: new Map([
			['left', left],
			['right', right]
		])
	};
}

describe('equal-power transition gain', () => {
	it('hits exact endpoints and keeps summed power constant', () => {
		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			const outgoing = equalPowerGain(progress, false);
			const incoming = equalPowerGain(progress, true);
			expect(outgoing * outgoing + incoming * incoming).toBeCloseTo(1, 12);
		}
		expect(equalPowerGain(0, false)).toBe(1);
		expect(equalPowerGain(0, true)).toBe(0);
		expect(equalPowerGain(1, false)).toBeCloseTo(0, 12);
		expect(equalPowerGain(1, true)).toBe(1);
	});

	it('builds exact full and partial sample-level curves', () => {
		const span: TransitionGainSpan = {
			startSeconds: 1,
			durationSeconds: 2,
			isIncoming: true,
			dipToSilence: false
		};
		const full = buildTransitionGainCurve(span, 1, 3, 4);
		expect(full).toHaveLength(9);
		expect(full[0]).toBe(0);
		expect(full[4]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(full[8]).toBe(1);

		const partial = buildTransitionGainCurve(span, 2, 3, 4);
		expect(partial[0]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(partial[partial.length - 1]).toBe(1);
	});

	it('dips to silence between outgoing and incoming halves', () => {
		const outgoing: TransitionGainSpan = {
			startSeconds: 0,
			durationSeconds: 1,
			isIncoming: false,
			dipToSilence: true
		};
		const incoming = { ...outgoing, isIncoming: true };
		const outCurve = buildTransitionGainCurve(outgoing, 0, 1, 4);
		const inCurve = buildTransitionGainCurve(incoming, 0, 1, 4);
		expect(outCurve[0]).toBe(1);
		expect(outCurve[2]).toBe(0);
		expect(outCurve[4]).toBe(0);
		expect(inCurve[0]).toBe(0);
		expect(inCurve[2]).toBe(0);
		expect(inCurve[4]).toBe(1);
	});
});

describe('preview crossfade', () => {
	it('deduplicates matching video and linked-audio transitions', () => {
		const leftVideo = clip({ id: 'left-video', linkedGroupId: 'left-group' });
		const rightVideo = clip({
			id: 'right-video',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group'
		});
		const leftAudio = clip({
			id: 'left-audio',
			type: 'audio',
			trackId: 'audio',
			linkedGroupId: 'left-group'
		});
		const rightAudio = clip({
			id: 'right-audio',
			type: 'audio',
			trackId: 'audio',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group',
			sourceStart: 10,
			sourceEnd: 70
		});
		const transitions = [
			transition('left-video', 'right-video'),
			transition('left-audio', 'right-audio')
		];
		const items = [leftVideo, rightVideo, leftAudio, rightAudio];
		const itemsById = new Map(items.map((item) => [item.id, item]));
		expect(transitionGainSpansForItem(rightAudio, transitions, itemsById, FPS)).toHaveLength(1);
		expect(audioCrossfadeGainAtFrame(rightAudio, 60, transitions, itemsById)).toBeCloseTo(
			Math.sin((10 / 19) * (Math.PI / 2)),
			12
		);
	});
});

describe('transition mix planning', () => {
	it('clamps extensions to available source handles', () => {
		const left = clip({ id: 'left', sourceEnd: 60, sourceDuration: 63 });
		const right = clip({
			id: 'right',
			from: 60,
			mediaId: 'media-2',
			sourceStart: 4,
			sourceEnd: 64,
			sourceDuration: 90
		});
		const entries = planMixdown([left, right], [track('video')], FPS, [
			transition('left', 'right')
		]);
		expect(entries.find((entry) => entry.itemId === 'left')?.durationSeconds).toBeCloseTo(63 / FPS);
		const rightEntry = entries.find((entry) => entry.itemId === 'right')!;
		expect(rightEntry.whenSeconds).toBeCloseTo(56 / FPS);
		expect(rightEntry.sourceOffsetSeconds).toBe(0);
		expect(rightEntry.durationSeconds).toBeCloseTo(64 / FPS);
	});
});
