import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { buildAgentFingerprint } from './fingerprint';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function video(id: string, from: number): TimelineItem {
	return {
		id,
		trackId: track.id,
		from,
		durationInFrames: 30,
		label: id,
		type: 'video'
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
	transitionsStore.clear();
});

describe('assistant timeline fingerprint', () => {
	it('changes for text, effect parameter, transition, and selection edits', () => {
		const text: TimelineItem = {
			id: 'title',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Title',
			type: 'text',
			text: 'Hello'
		};
		timelineStore._setItems([text]);
		const initial = buildAgentFingerprint(['title']);
		timelineStore._setScrollPosition(240);
		expect(buildAgentFingerprint(['title'])).toBe(initial);
		timelineStore._setItems([{ ...text, text: 'Goodbye' }]);
		expect(buildAgentFingerprint(['title'])).not.toBe(initial);

		const clip = video('a', 0);
		timelineStore._setItems([
			{ ...clip, effects: [{ id: 'blur', type: 'blur', enabled: true, amount: 2 }] }
		]);
		const beforeEffect = buildAgentFingerprint(['a']);
		timelineStore._setItems([
			{ ...clip, effects: [{ id: 'blur', type: 'blur', enabled: true, amount: 8 }] }
		]);
		expect(buildAgentFingerprint(['a'])).not.toBe(beforeEffect);

		const right = video('b', 30);
		timelineStore._setItems([clip, right]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				presentation: 'fade',
				durationInFrames: 10,
				fromItemId: clip.id,
				toItemId: right.id,
				properties: { softness: 0.2 }
			}
		]);
		const beforeTransition = buildAgentFingerprint(['a']);
		transitionsStore.setAll([
			{
				...transitionsStore.list[0]!,
				properties: { softness: 0.8 }
			}
		]);
		expect(buildAgentFingerprint(['a'])).not.toBe(beforeTransition);
		expect(buildAgentFingerprint(['b'])).not.toBe(buildAgentFingerprint(['a']));
	});
});
