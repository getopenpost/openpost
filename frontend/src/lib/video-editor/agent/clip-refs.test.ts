import { beforeEach, describe, expect, it } from 'vitest';
import {
	buildClipRefs,
	resolveClipRef,
	resolveClipRefs,
	__resetClipRefsForTesting,
	setClipRefSelectionProvider
} from './clip-refs';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';

const track: TimelineTrack = {
	id: 'v1',
	name: 'V1',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

beforeEach(() => {
	__resetClipRefsForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [], fps: 30 });
});

describe('clip refs', () => {
	it('builds stable c1 refs in deterministic order and resolves them', () => {
		const a: TimelineItem = {
			id: 'a',
			trackId: track.id,
			from: 30,
			durationInFrames: 30,
			label: 'Second',
			type: 'video'
		};
		const b: TimelineItem = {
			id: 'b',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'First',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [a, b], fps: 30 });
		setClipRefSelectionProvider(() => ['b']);
		const refs = buildClipRefs();
		expect(refs[0]?.ref).toBe('c1');
		expect(refs[0]?.itemId).toBe('b');
		expect(refs[1]?.ref).toBe('c2');
		expect(resolveClipRef('c1')).toBe('b');
		expect(resolveClipRefs(['c1', 'c99'])).toEqual(['b']);
	});

	it('caps at 40 refs', () => {
		const items: TimelineItem[] = Array.from({ length: 50 }, (_, i) => ({
			id: `id-${i}`,
			trackId: track.id,
			from: i * 10,
			durationInFrames: 10,
			label: `Clip ${i}`,
			type: 'video'
		}));
		timelineStore.setAll({ tracks: [track], items, fps: 30 });
		const refs = buildClipRefs();
		expect(refs).toHaveLength(40);
		expect(resolveClipRef('c41')).toBeUndefined();
	});

	it('drops stale refs after rebuild', () => {
		const first: TimelineItem = {
			id: 'first',
			trackId: track.id,
			from: 0,
			durationInFrames: 10,
			label: 'One',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [first], fps: 30 });
		buildClipRefs();
		expect(resolveClipRef('c1')).toBe('first');
		const second: TimelineItem = {
			id: 'second',
			trackId: track.id,
			from: 0,
			durationInFrames: 10,
			label: 'Two',
			type: 'video'
		};
		timelineStore.setAll({ tracks: [track], items: [second], fps: 30 });
		buildClipRefs();
		expect(resolveClipRef('c1')).toBe('second');
	});
});
