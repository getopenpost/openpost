import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '../../project/types';
import { effectiveMediaTracks, normalizeTrackGroups, visibleTrackRows } from './track-groups';

function track(id: string, order: number, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...overrides
	};
}

describe('track group semantics', () => {
	it('inherits every runtime state without overwriting the child local state', () => {
		const group = track('group', 0, {
			isGroup: true,
			kind: undefined,
			locked: true,
			visible: false,
			muted: true,
			solo: true
		});
		const child = track('child', 1, { parentTrackId: group.id });
		const [resolved] = effectiveMediaTracks([group, child]);
		expect(resolved).toMatchObject({ locked: true, visible: false, muted: true, solo: true });
		expect(child).toMatchObject({ locked: false, visible: true, muted: false, solo: false });
	});

	it('collapses only display rows and keeps grouped media in the effective list', () => {
		const group = track('group', 0, { isGroup: true, kind: undefined, isCollapsed: true });
		const child = track('child', 1, { parentTrackId: group.id });
		const loose = track('loose', 2);
		expect(visibleTrackRows([group, child, loose]).map((row) => row.id)).toEqual([
			'group',
			'loose'
		]);
		expect(effectiveMediaTracks([group, child, loose]).map((row) => row.id)).toEqual([
			'child',
			'loose'
		]);
	});

	it('repairs nested and orphaned links without dropping tracks', () => {
		const normalized = normalizeTrackGroups([
			track('parent', 0, { isGroup: true, kind: undefined }),
			track('nested', 1, { isGroup: true, kind: undefined, parentTrackId: 'parent' }),
			track('orphan', 2, { parentTrackId: 'missing' }),
			track('child', 3, { parentTrackId: 'parent' })
		]);
		expect(normalized).toHaveLength(3);
		expect(normalized.find((candidate) => candidate.id === 'nested')).toBeUndefined();
		expect(
			normalized.find((candidate) => candidate.id === 'orphan')?.parentTrackId
		).toBeUndefined();
		expect(normalized.find((candidate) => candidate.id === 'child')?.parentTrackId).toBe('parent');
	});
});
